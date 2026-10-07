# Plano: Gestão de usuários na área admin

Status: decisões alinhadas, aguardando "go" explícito para implementação.
Origem: design do agente `architect` + decisões do usuário (2026-10-04).

## Decisões confirmadas

| # | Tema | Decisão |
|---|------|---------|
| 1 | Escopo | Emendar as seções congeladas de `prompt_course_platform.md` e registrar ADR em `docs/adr/` |
| 2 | Modelo de papéis | Papel único por usuário, linha `student` explícita (backfill + `handle_new_user`). Hierarquia: superadmin > admin > tutor > student |
| 3 | Desativação | Híbrido: flag no banco (fonte da verdade, gravada primeiro) + ban no Auth via Edge Function `admin-users`. Papel via RPC |
| 4 | Poderes do admin | Admin só gerencia alvos student/tutor e só atribui student/tutor. Apenas superadmin toca admin/superadmin |
| 5 | Alcance da desativação | Bloqueia login, reprodução e checkout. Matrículas preservadas; reativar restaura acesso. Webhook de PIX pendente ainda confirma o pedido |
| 6 | Motivo | Opcional, até 500 caracteres, gravado na auditoria. Sem UI de visualização de auditoria por ora |
| 7 | Usuário sem permissão em `/admin/*` | Página NotFound (404) |
| 8 | E2E | Adicionar Playwright neste escopo |

## Premissas assumidas (confirmar se discordar)

- Papel `tutor` é apenas um rótulo por enquanto (nenhuma capacidade nova).
- Landing pós-login permanece `state.from ?? '/'` (sem redirecionamento automático para admin).
- Lista não expõe `last_sign_in_at` nem status de confirmação de e-mail (minimiza PII/LGPD).
- Sem notificação por e-mail em desativação/troca de papel.
- Primeiro superadmin criado via seed/SQL, documentado em runbook.

## Invariantes server-side (transação no banco)

- I1: ator nunca é o alvo (papel e status).
- I2: sempre existe ao menos 1 superadmin ativo (lock `FOR UPDATE` ou advisory lock).
- I3: ator precisa estar ativo.
- I4: rank do ator estritamente maior que o rank atual do alvo e que o novo papel.
- I5: identidade do ator vem de `auth.uid()`, nunca do corpo.
- I6: concorrência otimista via `expectedRole` / `expectedActive` (409 `stale_target`).

## Tarefas (ordem de implementação, TDD)

Backend:
1. ADR + emenda das seções congeladas em `prompt_course_platform.md`.
2. `backend/contracts/adminUsers.ts` (papéis, códigos de erro, fixture da matriz) + espelho no frontend + teste de paridade.
3. Migração A18 (pgTAP primeiro): reshape para `app_private.user_access`, backfill, `handle_new_user`, tabela de auditoria append-only, `app.is_admin()` redefinida, `app.current_access()`. Atualizar testes a3/a14.
4. RPC `app.admin_list_users` (busca, filtros, limit <= 50, escape de `%_`).
5. RPCs `app.admin_set_user_role` e `app.admin_set_user_active` com locks e auditoria.
6. Checagem de `is_active` em `app.has_active_enrollment` e `checkout`, com testes de regressão.
7. Edge Function `admin-users` (Deno, DI): RPC primeiro, depois ban no Auth; 502 `auth_sync_failed` com retry idempotente. `verify_jwt = true`. Eventos PostHog novos.
8. Seed de fixtures (superadmin/admin/tutor/student).

Frontend:
9. Primitivos de UI: Dialog, Select, Table, Pagination, Badge.
10. `features/authz`: roles, permissions (mesma fixture da matriz), `useCurrentAccess`, `RoleRoute`. Limpar `['me']` no signOut.
11. `features/admin/users`: api, mapeamento de erros pt-BR, hooks de query/mutation (pessimistas), filtros na URL.
12. Componentes + `AdminUsersPage` (lazy) + rotas em `App.tsx` + link no Layout.
13. Playwright + fluxos críticos.

Revisão e docs:
14. `security-reviewer` (obrigatório) e `code-reviewer` em paralelo.
15. `doc-updater`: README (runbook do superadmin, matriz de papéis), ADR final.

## Pontos de atenção

- Verificar se o ban no GoTrue atual revoga refresh tokens; o JWT de acesso vale até 3600s, por isso o flag é checado no servidor.
- Guards no cliente são apenas UX; toda regra é repetida no SQL/EF.
- `service_role` somente dentro da Edge Function, depois da autorização pelo cliente do chamador.
- Gate A14: tabelas em `app_private` sem policies e sem grants.
