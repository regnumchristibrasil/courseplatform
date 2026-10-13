# Glossário

Termos e conceitos-chave da plataforma de cursos online. Referência cruzada: `docs/adr/0001-gestao-de-usuarios-admin.md`.

## Papéis de usuário

**Papel (Role)**  
Atributo de cada usuário: `superadmin`, `admin`, `tutor` ou `student`. Um papel por usuário.
Armazenado em `app_private.user_access`, sem policies (cliente não tem acesso direto).
Hierarquia: superadmin > admin > tutor > student.

**Superadmin**  
Papel de maior privilégio. Pode gerenciar qualquer usuário (papel, atividade) e outros
superadmins. Sempre existe ao menos um ativo (invariante I2). Primeiro superadmin criado
via runbook pós-deploy; demais via UI `/admin/users`.

**Admin**  
Papel de gestão limitada. Pode gerenciar apenas usuários `student` e `tutor`, atribuindo
apenas papéis `student` ou `tutor`. Nunca toca em `admin` ou `superadmin`. Sem acesso
a usuários com papel superior.

**Tutor**  
Papel de conteúdo. Acessa a área de gestão de cursos e pode editar módulos e aulas,
publicar, arquivar e excluir cursos, mas não pode alterar o preço nem a duração de acesso. Sem acesso à
gestão de usuários. Pode ser gerenciado por `admin` e `superadmin`.

**Aluno (Student)**  
Papel padrão atribuído a todo novo usuário. Único papel sem poderes administrativos.
Pode ser promovido por `admin` ou `superadmin`.

## Conteúdo e catálogo

**Curso**  
Produto vendido ao aluno: título, descrição, preço, duração de acesso e uma sequência
ordenada de módulos. Passa pelos status rascunho, publicado e arquivado.

**Módulo**  
Agrupamento ordenado de aulas dentro de um curso. Tem título e posição, e pode ser
arquivado.

**Aula**  
Unidade de conteúdo de um módulo: título, duração opcional, indicação de pré-visualização
gratuita e, quando pronta, um vídeo. Pode ser arquivada.

**Pré-visualização gratuita**  
Aula que qualquer usuário logado pode assistir sem matrícula.

**Status do curso**  
Rascunho (invisível ao público), publicado (no catálogo) ou arquivado (fora do catálogo,
preservado). Transições permitidas: rascunho para publicado; publicado para rascunho ou
arquivado; arquivado para rascunho.

**Portão de publicação**  
Condição para um curso estar publicado: preço definido, ao menos uma aula ativa, e toda aula
ativa com vídeo. Itens arquivados (aula ou módulo) não contam. Um curso publicado nunca pode
ficar fora do portão.

**Arquivamento (de curso, módulo ou aula)**  
Retirada reversível de um item do catálogo, preservando-o. Substitui a exclusão sempre
que há matrículas ou pedidos.

**Exclusão com vendas**  
Curso com matrículas ou pedidos nunca pode ser excluído, nem ter módulos ou aulas
excluídos; só arquivados.

**Preço do curso**  
Valor em reais, maior que zero e até R$ 100.000,00. Curso gratuito está fora de escopo.
Somente `admin` e `superadmin` o alteram.

**Duração de acesso**  
Dias de acesso após a matrícula; vazio significa acesso vitalício. Como o preço, só `admin` e
`superadmin` a alteram.

**Acesso do aluno**  
Quem comprou um curso o mantém até a data de expiração, mesmo que o curso seja despublicado
ou arquivado depois. Curso de acesso vitalício nunca expira.

**Recompra**  
Após a expiração, o curso volta a ser um produto comum do catálogo para aquele aluno, que
precisa comprá-lo de novo. Vale apenas se o curso estiver publicado.

**Auditoria de cursos**  
Registro append-only das ações sensíveis sobre cursos: alteração de preço e de duração de
acesso, mudança de status e exclusões. Edições de conteúdo (títulos, ordem, vídeos) não
são auditadas.

**Vídeo da aula**  
Referência a um vídeo do YouTube ou do Panda, informada como ID ou URL e normalizada.
A validação confere apenas o formato, não a existência do vídeo.

## Área do aluno

**Aula concluída**  
Aula que o aluno marcou manualmente como concluída. Não há conclusão automática por
tempo assistido. Pode ser desmarcada pelo aluno.

**Aula em andamento**  
Aula que o aluno abriu e ainda não concluiu. Não guarda posição de reprodução.

**Progresso do curso**  
Percentual de aulas ativas concluídas sobre o total de aulas ativas do curso. Aulas e
módulos arquivados ficam fora do numerador e do denominador, e não aparecem para o aluno.
A conclusão registrada é preservada, então desarquivar a aula a restaura.

**Comentário**  
Texto simples (até 2.000 caracteres, sem formatação) escrito em uma aula. Ordem: mais
recentes primeiro, 20 por página ("Carregar mais" busca a seguinte). O autor pode excluir o
próprio comentário; se ele tiver respostas, é exibido como "comentário removido", e sem
respostas deixa de aparecer. Não há edição, denúncia nem notificação por e-mail.

**Resposta**  
Comentário filho de outro comentário, exibido sob a raiz. Há um único nível: não se responde
a uma resposta. Uma resposta excluída deixa de aparecer.

**Equipe**  
Conjunto dos papéis `tutor`, `admin` e `superadmin`. Lê e escreve comentários em qualquer
curso e exclui qualquer comentário. Seus comentários exibem o selo "Equipe".

**Participação em comentários**  
Somente alunos com matrícula válida no curso e a equipe leem e escrevem comentários. Quem
só tem pré-visualização gratuita não participa. Matrícula expirada perde a participação.
O autor é exibido pelo primeiro nome.

**Continuar de onde parei**  
Ação que leva à primeira aula ativa não concluída, na ordem do curso. Com todas as aulas
concluídas, vira "Revisar curso" e leva à primeira aula.

**Persistência do progresso**  
O progresso pertence ao aluno e à aula, não à matrícula. Sobrevive a expiração, reembolso e
recompra, e nunca é zerado automaticamente.

**Meus cursos**  
Área do aluno com os cursos comprados. Curso com matrícula expirada aparece esmaecido
("Acesso expirado"), com o progresso visível e, se publicado, a ação "Comprar novamente".
Curso reembolsado não aparece. Abrir por link direto um curso expirado resulta em página não
encontrada.

**Moderação de comentários**  
A equipe pode excluir qualquer comentário. Ao excluir um comentário com respostas, as
respostas permanecem sob "comentário removido". O sistema guarda quem excluiu e quando, sem
tabela de auditoria própria.

**Limite de comentários**  
Cada aluno pode publicar até cerca de 10 comentários ou respostas por minuto. A equipe é
isenta. Comentários e respostas já excluídos continuam contando, então excluir e republicar
não contorna o limite. Excedido o limite, o aluno vê "Aguarde um instante antes de comentar de novo".

**Fora desta versão (área do aluno)**  
Avaliação com nota, materiais complementares, capa do curso, descrição da aula, subtítulo do
módulo, edição e denúncia de comentários, notificações, tempo real e retomada por posição de
vídeo. Cada um terá ticket próprio. Enquanto não houver capa, os cartões usam um espaço
reservado 16:9 com a marca.

## Gestão de acesso

**Usuário ativo (is_active)**  
Flag booleano em `app_private.user_access`. Determina se o usuário pode fazer login,
reproduzir vídeos, fazer checkout. Desativado = acesso bloqueado (login, video, compra).
Reativado = acesso restaurado (matrículas preservadas). Fonte de verdade no servidor;
ban no Auth (GoTrue) é best-effort.

**Desativação**  
Processo que marca um usuário inativo (`is_active = false`). Pode ser revertido (reativação).
Bloqueia: login (ban Auth), video playback, checkout, previews. Permite: leitura de catálogo,
perfil próprio, `current_access` RPC. Webhooks PIX pendentes ainda processam.

**Desativação híbrida**  
Modelo implementado: flag no banco (fonte da verdade, gravado PRIMEIRO) + ban no Auth
(best-effort, via Edge Function depois). Se Auth falha (502 `auth_sync_failed`), flag fica
correto e cliente pode fazer retry. JWT ainda vale até 3600s; mitigação: toda checagem
server-side valida `is_active`.

**Reativação**  
Processo inverso: marca `is_active = true` e desban no Auth. Cliente com token pendente
(até 3600s) recebe acesso server-side se `is_active = true`. Sem delay crítico.

## Auditoria e conformidade

**Auditoria administrativa**  
Tabela append-only `app_private.user_access_audit`. Registra: quem (actor_id), alvo
(target_id), ação (role_changed, active_changed), valores antigo/novo, motivo opcional,
timestamp. Sem UPDATE/DELETE (apenas INSERT). Accessível a owner/superuser para correções
emergenciais; não é imutável criptograficamente.

**Motivo (reason)**  
Campo livre (até 500 code points) na auditoria. Explicar POR QUÊ a mudança (ex:
"inatividade 90 dias", não "apoiador de X"). LGPD: proibido incluir dados pessoais.
Opcional; cliente pode deixar em branco.

**Retenção (LGPD)**  
Política deferred (futura ADR). Por enquanto: sem automação de apagamento. Dados auditados
ficam indefinidamente. Futura: definir período (ex: 2 anos) e mecanismo de erasure.

## Controle de concorrência

**expectedRole / expectedActive**  
Parâmetros de checagem otimista (optimistic locking). Client envia papel/status esperado;
servidor valida antes de UPDATE. Se não bater (outro admin mudou entrementes), retorna
409 `stale_target`. Idempotência: retry do client com novos expectedRole/expectedActive
re-sincroniza.

**stale_target**  
Código de erro (409): alvo modificado por outro actor entre a leitura do cliente e a
tentativa de escrita. Cliente deve re-ler estado e tentar novamente com novo expected value.
Defesa contra race conditions.

**Operação idempotente**  
Propriedade de RPC/EF que permite retry seguro. `admin_set_user_*` é idempotente:
chamar com mesmos parâmetros múltiplas vezes é no-op se o estado já é o esperado.
Retry após 502 no EF usa esta propriedade.

## Bootstrap e setup

**Bootstrap do primeiro superadmin**  
Processo pós-deploy em produção:
1. Aplicar migrations A18-A21.
2. Rodar backfill: `SELECT app_private.backfill_user_access();`
3. Pessoa cria conta (signup).
4. Operador obtém UUID fora de banda (confirma identidade).
5. Roda `backend/supabase/runbooks/bootstrap_superadmin.sql` com email e UUID.
6. Só depois: novos admins via UI `/admin/users`.

Runbook garante atomicidade e validações (email confirmado, sem ban, sem deleted_at).

**Fixtures de desenvolvimento**  
Usuários pré-criados em `backend/supabase/seed.dev.sql`: superadmin@example.test,
admin@example.test, tutor@example.test, student@example.test. Senhas locais fixas
(definidas em arquivo; nunca usar em produção). Carregadas com `deno task seed:dev`.
Guard: recusa e-mails não `@example.test` para evitar acidentes com dados reais.

## Arquitetura

**app_private.user_access**  
Tabela schema-private (sem RLS policies, sem grants ao cliente). Armazena: user_id (PK),
role, is_active. Backfill preenche usuários antigos como `student` ativo. Trigger
`handle_new_user` popula novos usuários.

**RPC (Stored Procedure)**  
Remote Procedure Call via PostgREST. Funções `SECURITY DEFINER` que rodam no contexto do
banco: `app.admin_list_users`, `app.admin_set_user_role`, `app.admin_set_user_active`,
`app.current_access`. Identidade do ator = `auth.uid()`.

**Edge Function (EF)**  
Função Deno/TypeScript em `supabase/functions/`. A EF `admin-users` chama RPC após
autorização, depois tenta ban no Auth. Retorna 502 `auth_sync_failed` se Auth falhar.
Observabilidade (PostHog), sanitização de PII.

**Matriz de permissões**  
Tabela explícita actor x target x action x new role → allowed/denied. Define quem pode
fazer o quê a quem. Implementada em `backend/contracts/adminUsers.ts`, espelhada no
frontend (`frontend/src/contracts/adminUsers.ts`). Teste de paridade verifica
byte-identidade.

**Invariantes (I1-I6)**  
Regras de integridade server-side:
- I1: ator ≠ alvo (SQL).
- I2: ≥1 superadmin ativo (trigger + deferred constraint).
- I3: ator ativo (SQL WHERE).
- I4: rank(ator) > rank(alvo), rank(novo_papel) (SQL).
- I5: ator = auth.uid() (SQL, nunca corpo).
- I6: concorrência otimista expectedRole/expectedActive (SQL).

## Integração

**PostHog**  
Plataforma de analytics. Eventos server-side novos: `admin_user_status_changed`,
`admin_action_denied`, `admin_user_status_sync_failed`, `$exception`. Sanitização:
`before_send` hook remove query param `q` em `/admin` routes, strips autocapture text.
`ph-no-capture` CSS em componentes admin.

**PII minimization**  
`app.admin_list_users` não expõe `last_sign_in_at` ou `email_confirmed_at`. Reduz risco
de LGPD. Qualquer admin pode enumerar emails (risco aceito).

## Erros

**Códigos de erro (AdminUsersErrorCode)**  
- `stale_target` (409): alvo modificado; retry com novo expected value.
- `forbidden` (403): ator não tem permissão sobre alvo/ação.
- `self_target` (403): ator tentou modificar a si mesmo.
- `last_superadmin` (409): tentativa de remover/desativar único superadmin ativo.
- `actor_inactive` (403): ator está inativo.
- `invalid_input` (400): parâmetro inválido (ex: reason > 500 chars).
- `auth_sync_failed` (502): EF falhou ao sincronizar Auth ban.
- `not_found` (404): usuário alvo não existe.

Nota: **status HTTP difere** entre RPC direto (PostgREST, mapeamento SQL SQLSTATE)
e EF. Clientes devem decidir por `error.code`, nunca por status HTTP.

## Conformidade

**Deferred constraint**  
Técnica PostgreSQL: constraint ativada no COMMIT, não em cada operação. A transação
pode violar I2 temporariamente; o ROLLBACK automático em erro garante.

**TRUNCATE guard**  
Proteção adicional em `app_private.user_access`: evita apagamento acidental sem passar
pelo trigger `assert_not_last_superadmin`. Defense in depth.

**Teste de paridade (parity test)**  
`backend/contracts/adminUsers.parity.test.ts` verifica se
`backend/contracts/adminUsers.ts` ≡ `frontend/src/contracts/adminUsers.ts` (byte-identicamente).
Garante cliente e servidor usam mesma matriz.
