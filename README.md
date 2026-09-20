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

## Problemas conhecidos / notas importantes

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
- O repositório ainda não tem `.git` inicializado (escolha deliberada, ver
  `PROGRESS.md`) -- nenhum dos comandos acima depende de git.

## O que este README não cobre

Deploy (Netlify, Supabase Pro, domínio verificado no Resend, credenciais
de produção do Mercado Pago) e decisões de arquitetura (ADRs) ainda não
foram documentados -- ver a seção "Track D" em `PROGRESS.md` para o estado
atual dessa documentação.
