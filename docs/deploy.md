# Deploy em produção

Status: rascunho. Reconstruído a partir das migrations, `config.toml`, `netlify.toml`, dos
arquivos de env e do runbook de bootstrap. Nenhum passo foi executado contra um projeto
real; os itens marcados **[verificar]** dependem de um primeiro deploy em staging.

## 1. Visão geral

| Camada | Plataforma | Como sobe |
|---|---|---|
| Frontend | Netlify (`npm run build`, publica `dist`, fallback SPA para `/index.html`) | Integração Git do Netlify |
| Banco, auth, cron | Supabase hospedado (Postgres 17, `pg_cron`, `pg_net`, Vault) | Workflow `deploy-backend` ou CLI |
| Edge Functions | Supabase (7 funções) | Workflow `deploy-backend` ou CLI |
| Pagamento | Mercado Pago (PIX) | Credenciais e webhook configurados à mão |
| E-mail | Resend | Domínio verificado e chave de API |
| Telemetria | PostHog | Chaves de projeto |

Recomendação: manter dois ambientes, `staging` e `production`, cada um com seu projeto
Supabase e seu site Netlify (ou branch deploy). Todo passo novo é ensaiado em staging.

## 2. Pipelines (GitHub Actions)

- `.github/workflows/ci.yml`: roda em PR e em push na `main`. Jobs: frontend (lint, testes,
  build), backend (deno lint, fmt, testes) e database (migrations + pgTAP em Supabase local).
- `.github/workflows/deploy-backend.yml`: disparo manual. Escolhe o ambiente, mostra as
  migrations pendentes (`db push --dry-run`), aplica e publica as funções.

O frontend não passa pelo Actions: o Netlify faz o build pela integração Git.

### Configuração única no GitHub

1. Criar os **Environments** `staging` e `production` em Settings > Environments.
2. Em `production`, ligar **Required reviewers** (aprovação antes de qualquer deploy).
3. Em cada environment:
   - Secret `SUPABASE_ACCESS_TOKEN`: token pessoal ou de conta de serviço do Supabase.
   - Secret `SUPABASE_DB_PASSWORD`: senha do Postgres do projeto.
   - Variable `SUPABASE_PROJECT_REF`: referência do projeto (não é segredo).
4. Proteger a branch `main` exigindo os três jobs do CI.

Os segredos das Edge Functions (seção 4.3) **não** passam pelo Actions: são definidos uma vez
com `supabase secrets set` e ficam no Supabase.

## 3. Pré-requisitos (uma vez)

- Projeto Supabase criado (plano Pro) para cada ambiente.
- Domínio de envio verificado no Resend (registros SPF, DKIM e DMARC).
- Conta Mercado Pago com credenciais de produção (e de sandbox para staging).
- Projeto PostHog e chave pública.
- Site Netlify ligado ao repositório, com base directory `frontend`.
- Decisão de Auth (ver 6): confirmação de e-mail, URLs de redirecionamento.

## 4. Primeiro deploy de um ambiente

### 4.1 Vincular o projeto

```bash
cd backend
supabase login
supabase link --project-ref <ref>
```

### 4.2 Banco de dados

```bash
supabase db push --dry-run   # confere o que será aplicado
supabase db push
```

- Nunca usar `supabase db reset` contra produção: apaga todos os dados.
- Não carregar `seed.dev.sql` (fixtures de desenvolvimento).
- **[verificar]** se `seed.sql` (dados iniciais) deve ser aplicado em produção e como.
- O Supabase hospedado concede `ALL` em tabelas novas do schema `public` a `anon`,
  `authenticated` e `service_role` (o ambiente local concede só TRUNCATE/REFERENCES/TRIGGER/
  MAINTAIN). A migration A14 redefine os grants para o estado pretendido e a auditoria dela
  aborta o `db push` se sobrar algo. Se falhar com `A14 grants audit failed`, inspecione:
  ```sql
  select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  order by 1, 2, 3;
  ```

### 4.3 Segredos das Edge Functions

```bash
supabase secrets set \
  MERCADOPAGO_ACCESS_TOKEN=... \
  MERCADOPAGO_PUBLIC_KEY=... \
  RESEND_API_KEY=... \
  POSTHOG_API_KEY=... \
  POSTHOG_HOST=... \
  CRON_SECRET="$(openssl rand -hex 32)" \
  APP_PUBLIC_URL=https://<dominio-do-frontend> \
  COMPANY_NAME="Regnum Christi Brasil" \
  SUPPORT_EMAIL=...
```

Guardar o valor de `CRON_SECRET` em cofre de senhas: ele é reutilizado no passo 4.5. Nunca
colar valores reais em chat, tickets ou logs.

### 4.4 Edge Functions

```bash
supabase functions deploy
```

Funções: `admin-courses`, `admin-users`, `checkout`, `outbox-drain`, `payments-reconcile`,
`payments-webhook`, `video-resolve`. O `verify_jwt` por função já está em `config.toml`
(desligado para o webhook e para as duas funções de cron, que têm autenticação própria).

**[verificar]** `PROGRESS.md` registra que imports relativos para fora de
`supabase/functions/` (os contratos em `backend/contracts/`) podem não sobreviver ao bundle do
deploy. Um crash de boot desse tipo já ocorreu e foi corrigido localmente. Confirmar com um
deploy real em staging antes de produção.

### 4.5 Cron (Vault)

Sem estes dois segredos, os jobs de `payments-reconcile` e `outbox-drain` não fazem nada
(apenas registram um aviso). Rodar no SQL Editor do Studio, uma vez por ambiente, fora do
controle de versão:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'cron_edge_functions_base_url');
select vault.create_secret('<mesmo valor de CRON_SECRET>', 'cron_secret');
```

Os jobs rodam a cada 5 minutos (migration A17).

### 4.6 Webhook do Mercado Pago

No painel do Mercado Pago, cadastrar a URL
`https://<ref>.supabase.co/functions/v1/payments-webhook` para os eventos de pagamento.
Passo manual e por ambiente.

### 4.7 Frontend (Netlify)

Variáveis de ambiente do site:

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | chave anon (pública; a RLS protege os dados) |
| `VITE_POSTHOG_KEY` | chave pública do PostHog |
| `VITE_POSTHOG_HOST` | host de ingestão do PostHog |
| `VITE_APP_ENV` | `staging` ou `production` |

Toda variável `VITE_` vai para o bundle do navegador: nunca colocar a chave `service_role`
nem qualquer segredo aqui.

### 4.8 Primeiro superadmin

Seguir `README.md`, seção "Primeiro superadmin (pós-deploy em produção)", e o runbook
`backend/supabase/runbooks/bootstrap_superadmin.sql`. A identidade da pessoa deve ser
confirmada fora de banda, pois o cadastro é aberto.

## 5. Deploys seguintes

1. Merge na `main` com o CI verde.
2. Rodar **Deploy backend** com `staging`; validar.
3. Rodar **Deploy backend** com `production` (exige aprovação). Em mudanças só de
   frontend, não é necessário.
4. Frontend: o Netlify publica sozinho a partir da `main` (ou do deploy de branch).
5. Migrations são só para frente. Não existe passo de rollback automático (ver 7).

## 6. Decisões de configuração a tomar antes do lançamento

- **Confirmação de e-mail.** `config.toml` tem `enable_confirmations = false` (cadastro
  aberto, sem confirmar). Esse arquivo não é aplicado ao projeto hospedado por `db push`;
  as configurações de Auth ficam no painel ou via `supabase config push`. Decidir se
  produção exige confirmação, e configurar Site URL e URLs de redirecionamento com o domínio
  real.
- **Domínio e CORS.** Confirmar o domínio final do frontend em `APP_PUBLIC_URL` e nas URLs
  de Auth.
- **Credenciais do Panda Video.** Dependem do ticket #9 (teste em sandbox).
- **`seed.sql`** em produção (ver 4.2).

## 7. Verificação pós-deploy (smoke test)

- [ ] Home e login abrem; rota inexistente mostra a página 404.
- [ ] Cadastro de um usuário de teste funciona.
- [ ] `/admin` retorna 404 para usuário sem papel de equipe e abre para o superadmin.
- [ ] Compra de um curso em sandbox: o PIX é gerado.
- [ ] O webhook chega e a matrícula é criada.
- [ ] O e-mail transacional é enviado (conferir no painel do Resend).
- [ ] Os jobs de cron executam: `select * from cron.job_run_details order ...` sem
      avisos de segredo ausente.
- [ ] Eventos chegam ao PostHog.
- [ ] Logs das funções sem erros de boot (painel do Supabase > Edge Functions > Logs).

## 8. Rollback e backup (lacunas)

Não documentados hoje. Pontos a definir:

- Backups: confirmar o plano de backup diário do Supabase Pro e se será ativado PITR.
- Migrations: não há `down`. Correção é uma nova migration para frente; antes de mudanças
  destrutivas, tirar um backup manual.
- Funções: o rollback é redeployar o commit anterior (workflow com a tag desejada).
- Frontend: o Netlify permite republicar um deploy anterior pelo painel.

## 9. Pendências conhecidas

- Os jobs do CI e do deploy nunca rodaram no GitHub; o primeiro run pode exigir ajustes
  (por exemplo, a lista de serviços excluídos em `supabase start -x`).
- Não existe ambiente de staging definido; criá-lo antes do primeiro deploy real.
