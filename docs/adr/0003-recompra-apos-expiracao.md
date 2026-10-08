# 0003. Recompra após expiração do acesso

Status: aceito
Data: 2026-10-08
Relacionado: ADR-0001 (gate `is_active` em checkout e matrícula); ADR-0002
(modelo de conteúdo e status do curso); `GLOSSARY.md` (termos "Acesso do
aluno" e "Recompra")

## Contexto

O acesso é modelado em `public.enrollments` com `status in ('active',
'refunded')`. A expiração é calculada dinamicamente a partir de
`expires_at`, e não é um terceiro status. O índice único parcial
`enrollments_one_active_per_user_course (user_id, course_id) where status =
'active'` garante uma matrícula ativa por par.

Isso cria um problema na recompra: após a expiração a linha continua com
`status = 'active'`. Quando o aluno compra de novo, `app.confirm_payment`
faz `INSERT ... ON CONFLICT (user_id, course_id) WHERE status = 'active' DO
NOTHING`; o conflito é silencioso, o pedido fica `paid` e nenhuma matrícula
nova é criada. O aluno paga e continua sem acesso.

Inversamente, sem uma regra no checkout, um aluno com acesso ainda válido
poderia pagar duas vezes pelo mesmo curso.

## Decisão

1. **Fechar a matrícula expirada na mesma transação da nova compra.** Em
   `app.confirm_payment`, antes do `INSERT`, a matrícula do par
   (usuário, curso) que esteja `active` com `expires_at <= now()` passa para
   `status = 'expired'`. Em seguida cria-se a nova matrícula ativa. As duas
   operações ocorrem na mesma transação do CAS do pedido, então não existe
   janela com zero ou duas matrículas ativas.
2. **Novo valor de status `expired`.** O check de `enrollments.status` passa
   a aceitar `'active' | 'refunded' | 'expired'`. `expired` só é gravado por
   esse fechamento; a leitura de acesso continua baseada em `expires_at`
   (`app.has_active_enrollment` não muda), de modo que o status `expired` é
   um registro histórico e não uma segunda fonte de verdade para o acesso.
3. **Checkout recusa quem ainda tem acesso válido.** A criação do pedido
   consulta `app.has_active_enrollment(user, course)`; se verdadeiro, retorna
   409 `already_enrolled` e não cria pedido nem cobrança. Isso cobre acesso
   vitalício (nunca expira). A checagem de `is_active` do ADR-0001 continua
   valendo antes.
4. **Recompra só com curso publicado.** Após a expiração o curso volta a ser
   produto comum do catálogo para o aluno: o checkout exige `status =
   'published'`, como para qualquer compra. Curso despublicado ou arquivado
   não pode ser recomprado.
5. **Reembolso inalterado.** `app.refund_order` revoga a matrícula `active`
   do par; um histórico com linhas `expired` e `refunded` coexiste com no
   máximo uma `active`.
6. **Corrida de pedidos pendentes.** Se dois pedidos do mesmo par forem
   confirmados em sequência, o segundo encontra a matrícula recém-criada
   ainda válida e mantém o comportamento atual de `DO NOTHING` (pedido
   `paid`, sem segunda matrícula). O checkout da decisão 3 torna esse caso
   raro; tratá-lo por reembolso fica fora de escopo.

## Consequências

Positivas:

- Recompra funciona sem mudar o índice único nem o predicado de acesso.
- Histórico preservado: cada compra gera sua matrícula, com datas próprias.
- Pagamento duplicado de acesso vigente é bloqueado antes da cobrança.

Negativas / custos:

- Nova migration (forward-only) ampliando o check de status e alterando o
  corpo de `app.confirm_payment`; assinatura e grants congelados.
- Consumidores que filtram `status = 'active'` devem continuar tratando
  `expires_at`; testes de regressão obrigatórios para
  `has_active_enrollment`, `confirm_payment` e `refund_order`.
- Pedido pago de curso não publicado (publicação revertida entre checkout e
  webhook) ainda cria matrícula, pois o webhook não reavalia o catálogo;
  aceito, já que o aluno pagou.

## Alternativas rejeitadas

- **Trocar o índice único para incluir `expires_at`/`granted_at`:**
  rejeitada; permite várias matrículas ativas e move a regra de acesso para
  a restrição.
- **Atualizar a matrícula existente (estender `expires_at`) em vez de criar
  nova:** rejeitada; perde o histórico por compra e complica reembolso, que
  precisa revogar exatamente a matrícula daquele pedido.
- **Job periódico (cron) que marca matrículas como expiradas:** rejeitada;
  cria janela entre a expiração e o job em que a recompra falha, além de
  mais uma peça operacional. O fechamento na transação da compra é
  suficiente.
- **Deletar a matrícula expirada:** rejeitada; destrói histórico e conflita
  com `on delete restrict` e com a auditoria de vendas.
- **Permitir compra antecipada para renovar acesso vigente:** rejeitada por
  ora; exigiria regra de soma de períodos. Fora de escopo do MVP.
- **Bloquear a recompra apenas na UI:** rejeitada; a regra precisa ser
  aplicada no servidor (checkout), como os demais gates.
