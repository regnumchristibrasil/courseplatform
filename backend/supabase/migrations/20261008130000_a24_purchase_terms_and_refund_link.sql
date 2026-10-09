-- A24: termos da compra congelados no pedido + vinculo matricula -> pedido
-- (ADR 0003).
--
-- 1) orders.access_duration_days: duracao do curso no momento da CRIACAO do
--    pedido (NULL = vitalicio). Preenchida por trigger no servidor, nunca
--    pelo cliente; confirm_payment passa a usar este valor, entao mudar o
--    curso entre o checkout e o pagamento nao altera o que foi comprado.
-- 2) enrollments.order_id: pedido que originou a matricula. refund_order
--    revoga a matricula do proprio pedido, nao a que estiver 'active' para
--    (usuario, curso) -- evita revogar a recompra ao reembolsar o pedido
--    antigo. Matriculas anteriores a esta migration ficam com order_id NULL
--    e mantem o comportamento antigo (fallback por usuario + curso).
--
-- Assinaturas e grants de confirm_payment e refund_order congelados.

alter table public.orders add column access_duration_days integer
  check (access_duration_days is null or access_duration_days > 0);

comment on column public.orders.access_duration_days is
  'Duracao de acesso do curso na criacao do pedido (NULL = vitalicio). Definida por trigger a partir de courses.access_duration_days; qualquer valor enviado no INSERT e ignorado.';

-- Pedidos existentes: congela o valor atual do curso (melhor aproximacao;
-- pedidos pendentes na hora do deploy passam a ter termos definidos).
update public.orders as o
  set access_duration_days = c.access_duration_days
  from public.courses c
  where c.id = o.course_id;

create function app_private.set_order_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.access_duration_days into new.access_duration_days
  from public.courses c
  where c.id = new.course_id;
  return new;
end;
$$;

revoke all on function app_private.set_order_terms() from public, anon, authenticated;

create trigger orders_set_terms
  before insert on public.orders
  for each row execute function app_private.set_order_terms();

alter table public.enrollments
  add column order_id uuid references public.orders (id) on delete set null;

comment on column public.enrollments.order_id is
  'Pedido que originou a matricula (app.confirm_payment). NULL em matriculas legadas.';

create index enrollments_order_id_idx on public.enrollments (order_id) where order_id is not null;

create or replace function app.confirm_payment(p_order_id uuid, p_provider_charge_id text, p_paid_at timestamptz)
returns table (did_transition boolean, order_status text, enrollment_id uuid, user_id uuid, course_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order_user_id uuid;
  v_order_course_id uuid;
  v_order_status text;
  v_access_duration_days integer;
  v_expires_at timestamptz;
  v_enrollment_id uuid;
begin
  -- CAS atomico: so quem vira status <> 'paid' -> 'paid' recebe
  -- did_transition = true. Nunca separar em SELECT-depois-UPDATE.
  update public.orders as o
    set status = 'paid',
        paid_at = p_paid_at,
        provider_charge_id = coalesce(p_provider_charge_id, o.provider_charge_id)
    where o.id = p_order_id
      and o.status <> 'paid'
    returning o.user_id, o.course_id, o.status, o.access_duration_days
    into v_order_user_id, v_order_course_id, v_order_status, v_access_duration_days;

  if found then
    -- Duracao congelada no pedido (A24); NULL = vitalicio.
    v_expires_at := case
      when v_access_duration_days is null then null
      else p_paid_at + make_interval(days => v_access_duration_days)
    end;

    -- Recompra: fecha a matricula 'active' porem vencida (ADR 0003).
    update public.enrollments as e
      set status = 'expired'
      where e.user_id = v_order_user_id
        and e.course_id = v_order_course_id
        and e.status = 'active'
        and e.expires_at is not null
        and e.expires_at <= now();

    insert into public.enrollments (user_id, course_id, status, granted_at, expires_at, order_id)
    values (v_order_user_id, v_order_course_id, 'active', p_paid_at, v_expires_at, p_order_id)
    on conflict (user_id, course_id) where status = 'active' do nothing
    returning id into v_enrollment_id;

    return query select true, v_order_status, v_enrollment_id, v_order_user_id, v_order_course_id;
    return;
  end if;

  select o.status, o.user_id, o.course_id into v_order_status, v_order_user_id, v_order_course_id
  from public.orders o
  where o.id = p_order_id;

  return query select false, v_order_status, null::uuid, v_order_user_id, v_order_course_id;
end;
$$;

comment on function app.confirm_payment(uuid, text, timestamptz) is
  'CAS atomico: orders.status <> ''paid'' -> ''paid''; fecha matricula vencida (''expired'') e cria a nova vinculada ao pedido (order_id) com a duracao congelada no pedido (ADR 0003). did_transition=true e o unico sinal que dispara o e-mail de confirmacao. service_role apenas.';

create or replace function app.refund_order(p_order_id uuid, p_refunded_at timestamptz)
returns table (did_transition boolean, revoked_enrollment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order_user_id uuid;
  v_order_course_id uuid;
  v_enrollment_id uuid;
begin
  update public.orders as o
    set status = 'refunded',
        refunded_at = p_refunded_at
    where o.id = p_order_id
      and o.status = 'paid'
    returning o.user_id, o.course_id into v_order_user_id, v_order_course_id;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  -- Revoga a matricula do proprio pedido. Matricula legada (order_id NULL)
  -- cai no casamento antigo por usuario + curso.
  update public.enrollments as e
    set status = 'refunded'
    where e.status = 'active'
      and (
        e.order_id = p_order_id
        or (e.order_id is null and e.user_id = v_order_user_id and e.course_id = v_order_course_id)
      )
    returning e.id into v_enrollment_id;

  return query select true, v_enrollment_id;
end;
$$;

comment on function app.refund_order(uuid, timestamptz) is
  'CAS: orders.status ''paid'' -> ''refunded'', depois revoga a matricula ativa do proprio pedido (order_id); legadas sem order_id casam por usuario + curso. service_role apenas.';
