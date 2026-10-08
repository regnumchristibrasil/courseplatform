# 0002. Modelo de conteúdo de cursos e papel Tutor

Status: aceito
Data: 2026-10-08
Emenda: ADR-0001 (decisão 2, definição do papel `tutor`)
Relacionado: ADR-0003 (recompra após expiração); `GLOSSARY.md` (seção
"Conteúdo e catálogo")

## Contexto

Hoje `public.lessons` pertence diretamente a `public.courses`
(`unique (course_id, position)`), e não existe interface de gestão de
conteúdo: cursos e aulas são escritos apenas via `service_role` (Studio ou
seed). A área admin de gestão de cursos exige:

- agrupar aulas em módulos ordenados;
- reordenar módulos e aulas sem violar a unicidade de posição durante a
  troca;
- permitir que a equipe edite conteúdo e vídeos sem abrir o acesso do
  cliente aos dados privados de vídeo (`app_private.lesson_assets`, acessível
  só por `app.get_playable_ref`);
- definir o que o papel `tutor` pode fazer, já que o ADR-0001 o deixou como
  rótulo sem capacidades.

## Decisão

1. **Tabela `modules` entre curso e aula.** Um curso tem N módulos ordenados;
   um módulo tem N aulas ordenadas. A aula passa a pertencer a um módulo
   (o curso é derivado do módulo). Módulos e aulas podem ser arquivados.
2. **Posições densas (1..N) com restrições deferrable.** A unicidade de
   posição (`unique (course_id, position)` em módulos e
   `unique (module_id, position)` em aulas) é `DEFERRABLE INITIALLY
   DEFERRED`, permitindo reordenar em uma única transação sem posições
   temporárias. Reordenar recebe a lista completa de ids e reescreve as
   posições de forma atômica.
3. **Acesso da equipe somente por RPCs.** Nenhuma policy de escrita para o
   cliente em cursos, módulos, aulas ou vídeos. Toda operação de gestão é
   uma RPC `SECURITY DEFINER` que valida o papel via `auth.uid()` e o flag
   `is_active` (mesmos princípios I3 e I5 do ADR-0001). O cliente nunca lê
   nem escreve `app_private.lesson_assets`; a referência do vídeo é
   informada na RPC, normalizada e gravada no servidor.
4. **Capacidades do Tutor.** `tutor` edita módulos e aulas (inclusive
   vídeos), publica, arquiva e exclui cursos. `tutor` **não** altera
   `price_cents` nem `access_duration_days`, e não acessa a gestão de
   usuários. `admin` e `superadmin` têm todas as capacidades de conteúdo,
   incluindo preço e duração de acesso. A regra é aplicada no SQL; o cliente
   apenas esconde os controles.
5. **Exclusão só sem vendas.** Curso com matrículas ou pedidos nunca é
   excluído, nem tem módulos ou aulas excluídos; apenas arquivados. A
   checagem ocorre na RPC, na mesma transação da exclusão.
6. **Portão de publicação.** Publicar exige ao menos uma aula ativa e toda
   aula ativa com vídeo; itens arquivados não contam. Transições de status
   permitidas: rascunho para publicado; publicado para rascunho ou
   arquivado; arquivado para rascunho.
7. **Auditoria de cursos append-only** para alteração de preço e de duração
   de acesso, mudança de status e exclusões. Edições de conteúdo não são
   auditadas.

### Emenda ao ADR-0001

A decisão 2 do ADR-0001 define `tutor` como "apenas um rótulo por enquanto
(nenhuma capacidade nova)". Essa definição fica **superada** por este ADR.
A hierarquia (`superadmin` > `admin` > `tutor` > `student`) e as regras de
gestão de usuários (matriz de permissões, I1-I6) permanecem inalteradas.

## Consequências

Positivas:

- Reordenação atômica e sem estados intermediários inválidos.
- Superfície de ataque mínima: dados de vídeo continuam inacessíveis ao
  cliente, mesmo para a equipe.
- Separação clara de responsabilidades: conteúdo (tutor) versus preço e
  acesso (admin).

Negativas / custos:

- Migração com reshape de `lessons` (nova coluna `module_id`, backfill com um
  módulo padrão por curso, ajuste de `unique`), e atualização de
  `app.get_playable_ref` e das views públicas.
- Restrições deferrable exigem que a reordenação rode em uma única
  transação; erros só aparecem no COMMIT.
- Toda operação de gestão é uma RPC a mais para manter e testar; não há
  CRUD genérico via PostgREST.

## Alternativas rejeitadas

- **Manter aulas direto no curso, com "seção" como texto na aula:**
  rejeitada; reordenar seções e arquivar um módulo inteiro ficam frágeis.
- **Posições esparsas (gaps) ou fracionárias:** rejeitada; exigem
  renumeração periódica e complicam a leitura. Posições densas com
  restrição deferrable resolvem sem custo de leitura.
- **Posição temporária negativa/offset para trocar itens:** rejeitada;
  quebra se a transação for interrompida e polui a lógica da RPC.
- **Policies de RLS de escrita para `admin`/`tutor` nas tabelas de
  conteúdo:** rejeitada; não permite validar portão de publicação,
  normalização de vídeo nem separar preço do restante, e abriria acesso a
  `app_private.lesson_assets`.
- **Tutor com permissão sobre preço e duração de acesso:** rejeitada; são
  campos comerciais, mantidos com `admin`/`superadmin`.
- **Tutor sem poder de excluir ou publicar (somente editar):** rejeitada;
  criaria dependência de `admin` para o fluxo editorial corriqueiro.
- **Exclusão em cascata de cursos com vendas:** rejeitada; destruiria
  histórico financeiro e matrículas. Arquivamento cumpre o papel.
- **Auditar também edições de conteúdo:** rejeitada por ora; volume alto e
  baixo valor de compliance.
