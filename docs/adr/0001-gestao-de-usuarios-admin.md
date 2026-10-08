# 0001. Gestão de usuários na área admin

Status: aceito
Data: 2026-10-04
Plano de origem: `.claude/plans/admin-user-management.md`

## Contexto

A especificação original (`prompt_course_platform.md`) previa apenas uma
tabela de papéis separada, sem escrita pelo cliente, e administração via
console SQL do Supabase. Surgiu a necessidade de uma área `/admin` para
listar usuários, trocar papel e desativar/reativar contas. Isso exige:

- modelo de papéis com hierarquia explícita;
- desativação que bloqueie acesso mesmo com JWT já emitido (o JWT de acesso
  vale até 3600s);
- garantias server-side contra auto-promoção, escalada de privilégio e
  remoção do último superadmin.

As seções congeladas da especificação (modelo de dados, contratos de Edge
Functions, matriz RLS, entregáveis) foram emendadas para refletir esta
decisão; cada emenda traz marcador apontando para este ADR.

## Decisão

1. **Papel único por usuário**, com linha `student` explícita (backfill dos
   usuários existentes e `handle_new_user` para novos). Armazenado em
   `app_private.user_access`, sem policies e sem grants para o cliente.
2. **Hierarquia:** `superadmin` > `admin` > `tutor` > `student`. O papel
   `tutor` é apenas um rótulo por enquanto (nenhuma capacidade nova).
   **Emendada pelo ADR-0002:** a definição de `tutor` como rótulo está
   superada; o papel passa a ter capacidades de conteúdo de cursos (ver
   `0002-modelo-de-conteudo-de-cursos.md`). A hierarquia permanece.
3. **Desativação híbrida:** o flag `is_active` no banco é a fonte da
   verdade e é gravado primeiro; em seguida a Edge Function `admin-users`
   aplica o ban no Auth (GoTrue). Falha no Auth retorna 502
   `auth_sync_failed`, com retry idempotente. O papel é alterado via RPC.
4. **Poderes do admin:** `admin` só gerencia alvos `student`/`tutor` e só
   atribui `student`/`tutor`. Apenas `superadmin` toca `admin`/`superadmin`.
5. **Alcance da desativação:** bloqueia login, reprodução
   (`app.has_active_enrollment`) e checkout. Matrículas são preservadas;
   reativar restaura o acesso. Webhook de PIX pendente ainda confirma o
   pedido.
6. **Motivo opcional** (até 500 caracteres), gravado em tabela de auditoria
   append-only. Sem UI de visualização de auditoria por ora.
7. **Usuário sem permissão em `/admin/*`** (não staff) recebe a página
   NotFound (404), sem revelar a existência da área.
8. **E2E:** Playwright entra neste escopo para os fluxos críticos.

### Invariantes server-side (transação no banco)

- **I1:** ator nunca é o alvo (papel e status). Enforcement: SQL (`actor_id ≠ target_id`).
- **I2:** sempre existe ao menos 1 superadmin ativo (lock `FOR UPDATE` ou advisory lock).
  Enforcement: trigger `assert_not_last_superadmin` na RPC + deferred constraint
  (DEFERRABLE INITIALLY DEFERRED) que levanta erro em COMMIT se violar. TRUNCATE guard
  adicional em `app_private.user_access` (defense in depth).
- **I3:** ator precisa estar ativo. Enforcement: SQL (`WHERE is_active = true`),
  checagem antes de qualquer operação.
- **I4:** rank do ator estritamente maior que o rank atual do alvo e que o novo papel.
  Enforcement: SQL (`ROLE_RANK[actor_role] > ROLE_RANK[current_role]` e
  `ROLE_RANK[actor_role] > ROLE_RANK[new_role]`).
- **I5:** identidade do ator vem de `auth.uid()`, nunca do corpo da requisição.
  Enforcement: SQL (`actor_id := auth.uid()`).
- **I6:** concorrência otimista via `expectedRole` / `expectedActive` (409
  `stale_target`). Enforcement: SQL compara valores esperados antes de UPDATE.

Detalhe crítico de I2: o branch de checagem no RPC `admin_set_user_role` /
`admin_set_user_active` é logicamente INACESSÍVEL via os RPCs publicamente
expostos (a guard de `ator ≠ alvo` previne auto-demoção); a remoção do último
superadmin só é possível via SQL direto. Para apagá-lo, um operador deve: (1)
promover um sucessor; (2) deletar o primeiro em uma transação separada. Runbook
em `backend/supabase/runbooks/bootstrap_superadmin.sql` documenta a sequência.

Guards no cliente são apenas UX; toda regra é repetida no SQL e na Edge
Function. `service_role` só é usado dentro da Edge Function, após a
autorização feita com o cliente do chamador.

## Implementação

### Modelo de dados

- **`app_private.user_access`:** tabela com PK(user_id), coluna `role` (superadmin,
  admin, tutor, student), coluna `is_active` (boolean). Backfill no A18 promove todos
  os usuários existentes a `student`; trigger `handle_new_user` após `auth.users` INSERT
  popula novos usuários como `student` ativo.
- **`app_private.user_access_audit`:** tabela append-only (sem UPDATE), PK(id), colunas
  `actor_id`, `target_id`, `action` ('role_changed' ou 'active_changed'), `old_value`,
  `new_value`, `reason` (free text até 500 code points, LGPD: sem dados pessoais),
  `created_at`. Owner/superuser podem fazer bypass se necessário para correções; a
  auditoria é para compliance, não para imutabilidade criptográfica.
- **`app_private.user_access_audit` retention:** política LGPD a definir (escopo futuro);
  por enquanto não há automação de apagamento.

### RPCs (SECURITY DEFINER)

1. **`app.admin_list_users`**
   - Retorna: `{ users: AdminUserRow[], total: number }`
   - Não expõe: `last_sign_in_at`, `email_confirmed_at` (PII minimization).
   - Filtros: search por email (pg_trgm se houver muitos usuários), role, is_active.
   - Limit: máximo 50 por página. Busca sensível a diacríticos (ASCII collation).
   - Nota: todo admin pode enumerar TODOS os emails (risco aceito, não há segredo).

2. **`app.admin_set_user_role`**
   - Parâmetros: `userId`, `role`, `expectedRole`, `reason` (opcional).
   - Checagens: ator ≠ alvo (I1), ator ativo (I3), rank(ator) > rank(alvo) e
     rank(alvo novo) (I4), expectedRole == rol atual (I6, concorrência otimista).
   - Retorna: `{ userId, role }`.
   - Errors: `stale_target` (409), `forbidden` (403), `self_target` (403),
     `actor_inactive` (403), `last_superadmin` (409 se tentar remover último superadmin),
     `invalid_input` (400).

3. **`app.admin_set_user_active`**
   - Parâmetros: `userId`, `active`, `expectedActive`, `reason` (opcional).
   - Checagens: mesmas de `set_user_role` + expectedActive == is_active atual (I6).
   - Efeito: gravação do flag no banco PRIMEIRO; Edge Function `admin-users` tenta
     aplicar o ban no Auth logo após (idempotência com no-op antes de stale_target).
   - Retorna: `{ userId, isActive }`.

4. **`app.current_access`**
   - Sem parâmetros. Retorna: `{ role, isActive }` do usuário autenticado.
   - Usado pelo cliente para atualizar permissões.

### Edge Function `admin-users`

- **Rota:** `POST /functions/v1/admin-users`
- **Autenticação:** `verify_jwt = true` (JWT do cliente, service_role internamente).
- **Fluxo para `set_active`:**
  1. RPC lado do servidor retorna sucesso (flag `is_active` atualizado no banco).
  2. Edge Function tenta banir ou desbanir o usuário no Auth (GoTrue).
  3. Se Auth retorna erro 502 ou timeout: retorna 502 `auth_sync_failed` ao cliente.
  4. Cliente pode fazer retry: a chamada é idempotente porque a tentativa posterior encontra
     o mesmo estado esperado (`expectedActive` bate) e faz no-op se nada mudou.
- **Idempotência:** o retry após 502 re-sincroniza o Auth ban. Se o cliente recebe 200 sucesso
  mas o Auth não foi atingido, o flag está correto e o JWT ainda vale até 3600s; a próxima
  checagem server-side (RPC ou acesso) vê o flag e bloqueia.
- **Papel e status:** Edge Function modifica APENAS `is_active`. Mudança de papel vai via RPC.
- **PostHog:**
  - Eventos novos: `admin_user_status_changed`, `admin_action_denied`,
    `admin_user_status_sync_failed`, `$exception`.
  - Sanitização: `before_send` hook remove query param `q` em rotas `/admin` (PII)
    e strips autocapture element text em áreas admin.
  - `ph-no-capture` classe CSS em componentes admin-only (DataGrid, formulários).

### Desativação: escopo

**O que bloqueia:**
- Login (ban no Auth + flag server-side).
- Reprodução de vídeo: `app.has_active_enrollment` inclui `is_active = true`.
- Checkout: RPC `app.confirm_payment` retorna 403 `forbidden` se usuário não ativo.
- Preview de vídeo (free_preview): `app.get_playable_ref` checagem `is_active`.

**O que NÃO bloqueia (reachable):**
- Leitura benign: GET `/public/courses`, GET `/public/lessons`.
- Leitura do próprio perfil: GET do `public.users` linha do usuário.
- Atualização do próprio perfil: `app.update_profile` se não-blocked por `is_active`.
- `current_access` RPC (sempre acessível, permite cliente checar e redirecionar).
- Webhook PIX pendente de confirmação ainda processa se `provider_status = 'pending'`
  (o flag não retroage para pedidos).

**JWT:**
- Access token válido até 3600s. Desativação não o revoga instantaneamente
  (depende de ban no Auth, que pode falhar). Mitigação: toda checagem server-side
  valida `is_active` antes de qualquer operação sensível.

### Matriz de permissões

| Actor    | Target  | Ação       | Novo Papel | Permitido? |
|----------|---------|------------|-----------|-----------|
| superadmin | student | set_role   | student   | Sim (I4) |
| superadmin | student | set_role   | admin     | Sim (I4) |
| superadmin | admin   | set_role   | student   | Sim (I4) |
| superadmin | superadmin | set_role | admin     | Sim (I4, par) |
| admin    | student | set_role   | student   | Sim |
| admin    | student | set_role   | tutor     | Sim |
| admin    | student | set_role   | admin     | Não (I4) |
| admin    | admin   | set_role   | student   | Não (I4) |
| tutor    | student | set_role   | student   | Não (forbidden) |
| student  | *       | set_role   | *         | Não (forbidden) |
| *        | self    | set_* | * | Não (I1) |

Todas as linhas: actor deve estar ativo (I3) e não ser o alvo (I1).

### Migrations (A18-A21)

- **A18:** reshape `app_private.user_access`, backfill, trigger `handle_new_user`, audit table,
  `app.is_admin()` redefinida, RPC `app.current_access`.
- **A19:** RPCs `app.admin_list_users`.
- **A20:** RPCs `app.admin_set_user_role` e `app.admin_set_user_active`, helpers
  `lock_and_check_target`, `assert_not_last_superadmin`.
- **A21:** gate `app.has_active_enrollment` inclui `is_active`, gate `checkout` retorna
  403 forbidden.

Forward-only: foram editadas IN PLACE antes da primeira push (não houve revert).
Depois disso, mudanças vão via novas migrations (nenhuma edição post-push).

### Seed e desenvolvimento local

- **`backend/supabase/seed.dev.sql`:** fixtures de superadmin, admin, tutor, student.
  Senhas: localdev-only fixas, definidas no arquivo (não usar em produção).
- **Load:** fora do bloco `[db.seed]` em `config.toml` (seed.sql roda automático,
  seed.dev.sql roda manual: `deno task seed:dev`).
- **Guard:** script recusa e-mails não `@example.test` para evitar acidentes de push
  com dados reais.

### Runbook: primeiro superadmin

Arquivo: `backend/supabase/runbooks/bootstrap_superadmin.sql`

**Sequência pós-deploy (em produção):**
1. Aplicar migrations A18-A21.
2. Rodar `SELECT app_private.backfill_user_access();`
3. Pessoa cria conta normalmente (signup ou convite externo).
4. Operador:
   - Roda `SELECT id, email, ... FROM auth.users WHERE email = '<email>';` para
     obter o UUID e confirmar identidade OOB.
   - Edita `bootstrap_superadmin.sql` com o email e UUID.
   - Roda o script (transação atômica, aborta se dados não baterem).
5. Daí em diante: novo admin/superadmin via UI `/admin/users`, nunca SQL manual.

**Break-glass:** se o único superadmin ativo for apagado acidentalmente:
- Promover um candidato a superadmin via outro account superadmin (se houver).
- Se TODOS supers foram deletados: acesso emergencial via `psql` + runbook novamente.

## Consequências

Positivas:

- Fonte única de verdade para papel e status, imune a self-promotion
  (tabela em `app_private`, sem grants).
- Desativação efetiva imediatamente nas checagens server-side, mesmo com
  JWT válido.
- Auditoria de mudanças de papel e status desde o início.

Negativas / custos:

- Migração com reshape de tabela de papéis e backfill; testes a3/a14
  precisam ser atualizados (gate A14 mantido: `app_private` sem policies e
  sem grants).
- Dois sistemas a manter consistentes (flag no banco e ban no Auth);
  exige retry idempotente e tratamento de `auth_sync_failed`.
- Acoplamento de `has_active_enrollment` e `checkout` ao flag `is_active`
  (testes de regressão obrigatórios).
- Novo primeiro superadmin depende de seed/SQL documentado em runbook.
- Suite Playwright adiciona dependência e tempo de CI.
- Se o ban do GoTrue não revogar refresh tokens, o acesso ao Auth persiste
  até expirar; mitigado pela checagem server-side do flag.

Premissas assumidas: landing pós-login permanece `state.from ?? '/'`; a
lista não expõe `last_sign_in_at` nem confirmação de e-mail (minimiza
PII/LGPD); sem e-mail de notificação em desativação ou troca de papel.

## Riscos aceitos

1. **Enumeração de emails:** todo admin consegue listar todos os emails (RPC sem
   filtro de permissão por actor role na resposta). Mitigação: auditoria de acesso
   à lista via PostHog, e-mail do actor registrado. Aceito: a maioria dos casos de
   uso exige isso para buscar usuários.

2. **Re-sincronização do Auth pode falhar:** se o ban no Auth falhar (502), o flag
   no banco fica correto mas a revogação do refresh token não acontece até que o
   token expire ou o cliente tente renovar (até 3600s depois). Mitigação: toda
   operação sensível (checkout, video) checagem server-side de `is_active` antes de
   liberar acesso. Aceito trade-off necessário dada indisponibilidade ocasional do Auth.

3. **TRUNCATE em `app_private.user_access`:** defende I2 contra remoção acidental do
   último superadmin ativo, mas requer cuidado operacional. Sem este guard,
   transação interrompida poderia deixar a tabela vazia sem ser notado. Aceito:
   TRUNCATE command coverage no pg_dump/restore garante determinismo.

4. **Políticas LGPD em aberto:** auditoria não apaga registros antigos hoje;
   a política de retention e erasure será definida em uma ADR futura. Por enquanto:
   `reason` field **não deve incluir dados pessoais** (apenas contexto like
   "inatividade de 90 dias", nunca "apoiador de tal partido").

### Alternativas rejeitadas

- **Múltiplos papéis por usuário (N:N):** rejeitada; complica a regra de
  hierarquia (I4) e a matriz de permissões sem caso de uso atual.
- **Papel em coluna de `public.users` ou em `app_metadata` do JWT:**
  rejeitada; coluna com self-UPDATE é vetor de auto-promoção, e claims no
  JWT ficam obsoletos até 3600s.
- **Desativação apenas por ban no Auth:** rejeitada; não bloqueia JWT já
  emitido nem permite checagem em RPC/RLS.
- **Desativação apenas por flag no banco:** rejeitada; não impede novo
  login nem a renovação de sessão.
- **Admin com poder total sobre todos os papéis:** rejeitada; permitiria
  escalada lateral entre admins. Apenas superadmin gerencia staff.
- **Exibir 403 em `/admin` para não staff:** rejeitada; 404 não revela a
  existência da área.
- **Manter administração via console SQL:** rejeitada; não escala e não
  deixa trilha de auditoria.
- **Option A (all-RPC):** todos os RPCs em `admin_set_user_*` com ban direto no Auth.
  Rejeitado: sem Edge Function, sem retry idempotente, sem observabilidade centralizada.
- **Option C (single EF):** um único `admin-users` EF que chama RPC e trata erros.
  Rejeitada: menor reuso; `admin_set_*` RPCs úteis standalone.
- **Two-person rule:** exigir aprovação de dois admins antes de promover superadmin.
  Rejeitada: aumenta overhead operacional e não está no escopo do MVP.
- **Auth re-sync race fix:** usar DEFERRABLE trigger com redo no EF em caso de 502.
  Parcialmente implementada: deferred constraint garante I2, retry no cliente garante
  re-sincronização.
- **pg_trgm index:** deferred para quando houver muitos usuários (hoje <1000); limit
  e paginação simples bastam.
