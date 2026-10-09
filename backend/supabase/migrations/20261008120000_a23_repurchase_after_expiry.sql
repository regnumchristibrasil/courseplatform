-- A23: recompra apos expiracao (ADR 0003).
--
-- Antes: uma matricula expirada continuava com status 'active', entao o
-- INSERT ... ON CONFLICT DO NOTHING de app.confirm_payment nao criava a nova
-- matricula (aluno pagava e ficava sem acesso).
--
-- Agora: status ganha o valor 'expired' e confirm_payment fecha a matricula
-- expirada do par (usuario, curso) na mesma transacao, antes de inserir a
-- nova. O predicado de acesso (app.has_active_enrollment) nao muda: continua
-- baseado em expires_at; 'expired' e apenas historico.
--
-- Assinatura e grants de confirm_payment congelados: so o corpo muda.

alter table public.enrollments drop constraint enrollments_status_check;
alter table public.enrollments
  add constraint enrollments_status_check
  check (status in ('active', 'refunded', 'expired'));

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
    returning o.user_id, o.course_id, o.status into v_order_user_id, v_order_course_id, v_order_status;

  if found then
    select c.access_duration_days into v_access_duration_days
    from public.courses c
    where c.id = v_order_course_id;

    -- NULL = acesso vitalicio; senao expira N dias apos a liquidacao
    -- (p_paid_at), calculado agora e gravado: mudar a duracao do curso
    -- depois nao altera matriculas ja compradas.
    v_expires_at := case
      when v_access_duration_days is null then null
      else p_paid_at + make_interval(days => v_access_duration_days)
    end;

    -- Recompra: fecha a matricula ainda 'active' porem vencida, na mesma
    -- transacao do CAS, para liberar o indice unico parcial. Matricula
    -- vigente (nao vencida) nunca e tocada.
    update public.enrollments as e
      set status = 'expired'
      where e.user_id = v_order_user_id
        and e.course_id = v_order_course_id
        and e.status = 'active'
        and e.expires_at is not null
        and e.expires_at <= now();

    insert into public.enrollments (user_id, course_id, status, granted_at, expires_at)
    values (v_order_user_id, v_order_course_id, 'active', p_paid_at, v_expires_at)
    on conflict (user_id, course_id) where status = 'active' do nothing
    returning id into v_enrollment_id;

    return query select true, v_order_status, v_enrollment_id, v_order_user_id, v_order_course_id;
    return;
  end if;

  -- Sem transicao: pedido ja 'paid' (webhook duplicado) ou inexistente.
  select o.status, o.user_id, o.course_id into v_order_status, v_order_user_id, v_order_course_id
  from public.orders o
  where o.id = p_order_id;

  return query select false, v_order_status, null::uuid, v_order_user_id, v_order_course_id;
end;
$$;

comment on function app.confirm_payment(uuid, text, timestamptz) is
  'CAS atomico: orders.status <> ''paid'' -> ''paid''; fecha matricula vencida (status ''expired'') e cria a nova via ON CONFLICT DO NOTHING (ADR 0003). did_transition=true e o unico sinal que dispara o e-mail de confirmacao. service_role apenas.';
