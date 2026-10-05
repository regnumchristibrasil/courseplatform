# Course Platform

Plataforma de cursos online: catálogo público, checkout via PIX (Mercado
Pago), vídeo-aulas protegidas (YouTube não listado hoje, migração para
Panda Video planejada) e e-mails transacionais (Resend). Frontend em
React/Vite, backend inteiramente em Supabase (Postgres + RLS + Auth + Edge
Functions em Deno/TypeScript) — sem servidor próprio.

A especificação técnica completa (contratos congelados, modelo de dados,
requisitos não funcionais) está em `prompt_course_platform.md`. O histórico
de implementação e o estado atual de cada tarefa estão em `PROGRESS.md` —
este README cobre apenas **como rodar o projeto em ambiente de
desenvolvimento local**.

## Pré-requisitos

- **Docker** — necessário para a stack local do Supabase (Postgres, Auth,
  PostgREST, Storage, Edge Runtime, Studio).
- **Node.js 22+** e **npm** — testado com Node v22.22.3 / npm 11.15.0.
- **Deno 2.9+** — testado com 2.9.6.
- **Supabase CLI 2.x** — testado com 2.114.0.

## Estrutura do repositório

```
frontend/    React + Vite + TypeScript (Vitest para testes, oxlint)
backend/     Supabase: migrations SQL/RLS (supabase/migrations/),
             Edge Functions em Deno (supabase/functions/),
             contratos TS compartilhados (contracts/)
```

## Configuração inicial

### 1. Backend (Supabase local)

```bash
cd backend

# Variáveis das Edge Functions -- IMPORTANTE: o Supabase local lê os
# segredos deste caminho específico, não de backend/.env
cp .env.example supabase/functions/.env
# preencha supabase/functions/.env -- valores fictícios (porém bem
# formados) já bastam para as funções subirem e a lógica de
# validação/erros ser exercitada localmente; só é preciso credenciais
# reais para de fato criar uma cobrança PIX, enviar um e-mail ou ver
# eventos chegando no PostHog

# Sobe a stack local (primeira vez baixa as imagens Docker, pode demorar)
supabase start

# Aplica todas as migrations + seed.sql, estado determinístico
supabase db reset
```

Ao final de `supabase start`, o terminal imprime as URLs e chaves da stack
local (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, etc.) -- usadas na
configuração do frontend a seguir. Rode `supabase status` a qualquer
momento para ver os mesmos valores novamente.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
# preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY com os valores
# impressos por `supabase start` (URL/ANON_KEY)

npm install
npm run dev
```

Acesse `http://localhost:5173`.

## Comandos úteis

### Backend (a partir de `backend/`)

| Comando | O que faz |
|---|---|
| `supabase start` | Sobe a stack local completa |
| `supabase stop` | Para a stack local |
| `supabase status` | Mostra URLs/chaves da stack em execução |
| `supabase db reset` | Reaplica todas as migrations + `seed.sql` |
| `supabase test db` | Roda a suíte pgTAP (schema/RLS) |
| `deno task test` | Roda os testes das Edge Functions, com cobertura |
| `deno task coverage` | Gera relatório de cobertura (lcov + HTML) do último `deno task test` |
| `deno task fmt` | Formata o código Deno |
| `deno task lint` | Lint do código Deno |

### Frontend (a partir de `frontend/`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Vite) |
| `npm run build` | Build de produção (`tsc -b && vite build`) |
| `npm test` | Roda os testes (Vitest) |
| `npm run lint` | Lint (oxlint) |
| `npm run test:e2e` | Roda E2E (Playwright) |
| `npx playwright install chromium` | Primeiro run: instala chromium (necessário para E2E) |

## URLs locais (após `supabase start`)

| Serviço | URL |
|---|---|
| API (PostgREST / Auth / Edge Functions) | `http://127.0.0.1:54321` |
| Studio (painel administrativo) | `http://127.0.0.1:54323` |
| Banco de dados (Postgres) | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Mailpit (captura e-mails enviados via SMTP local) | `http://127.0.0.1:54324` |
| Frontend (Vite dev server) | `http://localhost:5173` |

O Studio (`http://127.0.0.1:54323`) é o jeito mais rápido de inspecionar
tabelas, criar usuários de teste (Authentication → Users) e ver os dados do
`seed.sql`.

## Testando E2E com Playwright

Pré-requisito: instale chromium (primeira vez apenas):
```bash
cd frontend
npx playwright install chromium
```

Execute em dois terminais:

**Terminal 1 (backend):**
```bash
cd backend
supabase start
supabase db reset
deno task seed:dev  # carrega fixtures de dev
# Create .env outside the repo with fake values:
supabase functions serve --env-file /tmp/supabase-dev.env
```

**Terminal 2 (frontend):**
```bash
cd frontend
npm run test:e2e
```

Playwright inicia um dev server na porta 5199 automaticamente. Variáveis de env para E2E
(definidas em `frontend/playwright.config.ts`):
- `E2E_DB_CONTAINER`: container name do Postgres (default: `supabase_db_backend`)
- `E2E_PORT`: porta da API local (default: 54321)
- `E2E_FIXTURE_PASSWORD`: senha dos fixtures (default: igual em `seed.dev.sql`)

## Testando as Edge Functions localmente

Toda função fica disponível em
`http://127.0.0.1:54321/functions/v1/<nome-da-funcao>` assim que a stack
sobe -- não é necessário nenhum passo de deploy para testar localmente.

Funções que exigem um usuário autenticado (`checkout`, `video-resolve`)
precisam de um JWT real no header `Authorization`. Para obter um, crie um
usuário via Studio (Authentication → Users → Add user) ou via a API de
signup diretamente:

```bash
curl -X POST "http://127.0.0.1:54321/auth/v1/signup" \
  -H "apikey: <ANON_KEY impresso por supabase start>" \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@example.com","password":"senha123456"}'
# a resposta traz access_token -- use-o como Bearer abaixo
```

```bash
curl -X POST "http://127.0.0.1:54321/functions/v1/checkout" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"<um id de curso do seed.sql>"}'
```

Com credenciais fictícias em `supabase/functions/.env`, o exemplo acima
retorna `502 payment_provider_error` -- é o comportamento esperado (a
função chegou a criar o pedido e tentou de fato falar com a API do Mercado
Pago, só falhou por causa do `MERCADOPAGO_ACCESS_TOKEN` fictício). Com um
token de sandbox real do Mercado Pago no lugar, o mesmo comando retorna o
QR code PIX normalmente.

Funções sem autenticação de usuário mas protegidas por segredo de cron
(`payments-reconcile`, `outbox-drain`) usam o header `X-Cron-Secret`, com o
valor de `CRON_SECRET` definido em `supabase/functions/.env`.

### Variáveis de env para Edge Functions (desenvolvimento local)

Create `supabase/functions/.env` (fora do repo, valores fictícios bastam):
```
MERCADOPAGO_ACCESS_TOKEN=fake
MERCADOPAGO_PUBLIC_KEY=fake
RESEND_API_KEY=fake
POSTHOG_API_KEY=fake
POSTHOG_HOST=fake
CRON_SECRET=fake
APP_PUBLIC_URL=http://localhost:5173
COMPANY_NAME=Regnum Christi Brasil
SUPPORT_EMAIL=support@example.test
```

Supabase local lê `.env` deste caminho específico, não de `backend/.env`.
Valores fictícios são suficientes para testar logicamente as funções; credenciais reais
só são necessários se de fato enviar dados aos provedores (Mercado Pago, Resend, PostHog).

## Testes pgTAP (schema, RLS, triggers)

Requer um banco de dados **limpo** (sem seed.dev carregado):

```bash
cd backend

# Banco APENAS com seed.sql (migrations + dados iniciais, sem fixtures de dev)
supabase db reset

# Roda pgTAP suite
supabase test db
```

Se você carregou `seed.dev.sql` e quer rodar os testes depois, precisa resetar:
```bash
supabase db reset  # Limpa e recarrega
deno task test:seed-dev  # Apenas se quiser seeds após testes
```

Alternativa: depois de `deno task seed:dev`, há `tests-dev/` com testes SQL que assumem
fixtures já carregadas (comportamento de integração, não isolamento).

## Administração de usuários (gestão de papéis e desativação)

A plataforma inclui uma área `/admin` para listar usuários, trocar papéis (student,
tutor, admin, superadmin) e desativar/reativar contas. O modelo é documentado em
`docs/adr/0001-gestao-de-usuarios-admin.md` (decisões de design, invariantes,
implementação).

### Primeiro superadmin (pós-deploy em produção)

Executado uma única vez, por um operador com papel dono do schema (`postgres`).
**Nunca use `supabase db reset` em produção** (apaga todos os dados).

1. Aplique as migrations A18-A21:
   ```bash
   cd backend
   supabase db push
   ```
   A migration A18 já executa `app_private.backfill_user_access()` (idempotente: toda conta
   sem papel vira `student` ativo). Não é preciso rodá-lo à mão.

2. A pessoa cria a conta normalmente (signup ou convite) e confirma o e-mail.

3. Leia o `user_id` e confirme a identidade fora de banda (contato direto, datas de
   criação e confirmação coerentes). O cadastro é aberto, então qualquer pessoa pode ter
   pré-registrado o e-mail:
   ```bash
   psql "$DATABASE_URL" -c "select id, email, email_confirmed_at, banned_until, deleted_at, created_at
     from auth.users where lower(email) = lower('<email>');"
   ```

4. Edite `backend/supabase/runbooks/bootstrap_superadmin.sql` e preencha os DOIS valores,
   nas linhas marcadas `EDITAR AQUI`: o e-mail e o `user_id` lido no passo anterior.
   Não commite o arquivo editado.

5. Rode o script. Ele executa em uma única transação e, se qualquer verificação falhar
   (e-mail inexistente ou não confirmado, `user_id` divergente, conta banida ou removida,
   já é superadmin ativo), levanta exceção e nada é gravado:
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/runbooks/bootstrap_superadmin.sql
   ```
   Em caso de dúvida antes do `commit`, troque-o por `rollback`.

6. Verifique o resultado:
   ```bash
   psql "$DATABASE_URL" -c "select user_id, role, is_active from app_private.user_access
     where role = 'superadmin';"
   psql "$DATABASE_URL" -c "select actor_id, target_id, action, old_value, new_value, reason
     from app_private.user_access_audit order by id desc limit 1;"
   ```
   Deve existir uma linha `superadmin` ativa e uma auditoria `role_changed` com o motivo
   `bootstrap do primeiro superadmin`.

7. Restaure o arquivo do runbook (`git checkout -- backend/supabase/runbooks/bootstrap_superadmin.sql`).
   A partir daqui, admins e superadmins são geridos pela tela `/admin/users`, nunca por SQL manual.

### Desenvolvimento local com admin

```bash
# Suba a stack local
cd backend
supabase start
supabase db reset

# Carregue as fixtures de dev (superadmin, admin, tutor, student)
deno task seed:dev

# Fixtures: senhas em backend/supabase/seed.dev.sql
# Usuários: superadmin@example.test, admin@example.test, etc.
```

Acesse `/admin` no frontend com a conta superadmin. Sem autenticação, recebe 404 (não revela existência da área).

### Matriz de permissões (resumida)

| Actor       | Pode gerenciar | Pode atribuir papéis | Notas |
|-------------|----------------|----------------------|-------|
| superadmin  | todos          | todos (4: s, a, t, e) | incluindo outro superadmin |
| admin       | student, tutor | student, tutor       | nunca toca admin/superadmin |
| tutor       | ninguém        | —                    | rótulo apenas, sem poderes |
| student     | ninguém        | —                    | usuário regular |

- e: student  
- t: tutor  
- a: admin  
- s: superadmin  

Detalhes em `docs/adr/0001-gestao-de-usuarios-admin.md`.

### Comandos úteis

```bash
# pgTAP: testes de schema/RLS/triggers (requer DB limpo, sem seed.dev carregado)
cd backend
supabase db reset  # carrega seed.sql APENAS (não seed.dev.sql)
supabase test db

# Testes das Edge Functions
deno task test
deno task coverage

# Sincronizar matriz de permissões (se alterar backend/contracts/adminUsers.ts)
# O arquivo deve ser espelhado byte-identicamente em frontend/src/contracts/adminUsers.ts
deno task gen:matrix
```

### Desativação: o que bloqueia e o que não

**Bloqueia:**
- Login (ban no Auth + flag server-side).
- Video playback (e free previews).
- Checkout (403 forbidden).

**Permite acesso:**
- Leitura do catálogo público.
- Leitura do perfil próprio.
- `current_access` RPC (cliente checagem estado, redirecionamento).

Webhook PIX pendente de confirmação ainda processa (a flag não retroage para ordens).

## Sincronizar matriz de permissões

Se alterar `backend/contracts/adminUsers.ts`, rode:
```bash
cd backend
deno task gen:matrix
```

O arquivo **deve ser espelhado byte-identicamente** em `frontend/src/contracts/adminUsers.ts`.
Há um teste de paridade (`backend/contracts/adminUsers.parity.test.ts`) que falha se divergirem.

## Problemas conhecidos / notas importantes

- **TRUNCATE com eventos deferred em aberto:** defesa de I2 (último superadmin).
  Se TRUNCATE for executado com deferred constraint triggers em aberto
  (de uma transação anterior), PostgreSQL retorna SQLSTATE 55006. Isso não é
  previsto em operação normal (migrations + seed + RPCs), apenas em SQL manual.

- **Alterar `supabase/config.toml` ou `supabase/functions/deno.json` exige
  reiniciar a stack por completo** (`supabase stop` seguido de
  `supabase start`) -- o hot-reload do Edge Runtime (`policy = "per_worker"`
  em `config.toml`) recarrega o código das funções entre requisições, mas
  não pega mudanças de configuração ou do import map. Sem isso, toda função
  passa a falhar ao subir com um erro de resolução de import.
- **`supabase start` sozinho às vezes não recria um container que foi
  parado manualmente fora do fluxo do CLI** (ex.: um `docker stop` direto).
  Se `supabase status` ou `docker ps` mostrarem `edge_runtime`/`pooler`/
  `imgproxy` como parados mesmo depois de `supabase start`, rode o ciclo
  completo `supabase stop && supabase start` em vez de tentar subir o
  container manualmente.
- **`backend/supabase/functions/.env` precisa existir e estar
  preenchido** (mesmo com valores fictícios) para as Edge Functions não
  falharem no boot local -- `loadBackendConfig()` valida todas as
  variáveis de uma vez e lista tudo que estiver faltando ou inválido em um
  único erro.

## O que este README não cobre

Deploy (Netlify, Supabase Pro, domínio verificado no Resend, credenciais
de produção do Mercado Pago) e decisões de arquitetura (ADRs) ainda não
foram documentados -- ver a seção "Track D" em `PROGRESS.md` para o estado
atual dessa documentação.
