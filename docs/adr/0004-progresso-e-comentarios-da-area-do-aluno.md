# 0004. Modelo de progresso e comentários da área do aluno

Status: aceito
Data: 2026-10-12
Relacionado: ADR-0001 (gate `is_active`, identidade via `auth.uid()`); ADR-0002
(acesso somente por RPCs); ADR-0003 (recompra após expiração); `GLOSSARY.md`
(seção "Área do aluno")

## Contexto

A área do aluno permite assistir aos cursos comprados, acompanhar o progresso
e comentar nas aulas. Hoje existem `modules`, `lessons`, `enrollments`,
`app.has_active_enrollment` e `app.get_playable_ref` (A26: matrícula válida
toca qualquer aula do curso, inclusive arquivada), mas nenhuma estrutura para
progresso ou comentários. Três decisões são difíceis de reverter depois que
houver dados de alunos.

## Decisão

1. **Progresso pertence ao aluno e à aula, não à matrícula.** Uma linha por
   (`user_id`, `lesson_id`), com `first_opened_at` e `completed_at`. Expiração,
   reembolso e recompra não alteram nem apagam essas linhas (ADR-0003 cria uma
   matrícula nova na recompra; o progresso continua valendo). Nada zera o
   progresso automaticamente.
2. **Conclusão apenas manual.** O aluno marca e desmarca. "Em andamento" é a
   aula aberta e não concluída, sem posição de reprodução. O percentual é
   calculado na leitura (aulas ativas concluídas sobre aulas ativas), sem
   coluna derivada armazenada; aulas e módulos arquivados ficam fora do
   numerador e do denominador, e a conclusão registrada é preservada.
3. **Acesso somente por RPCs, leitura e escrita.** As tabelas de progresso e
   comentários têm RLS ligado e nenhuma policy para o cliente. Leituras
   (árvore do curso, "meus cursos", lista de comentários) são RPCs
   `SECURITY DEFINER` com `search_path = ''`, que validam `auth.uid()` e
   `is_active` e retornam zero linhas, nunca erro, para quem não tem direito
   (mesmo princípio de `get_playable_ref`).
4. **Participação em comentários atrelada à matrícula válida.** Leem e
   escrevem apenas alunos com matrícula válida no curso e a equipe (`tutor`,
   `admin`, `superadmin`). Matrícula expirada perde a participação. Quem tem
   só pré-visualização gratuita não participa. A RPC de leitura projeta o
   primeiro nome do autor e o indicador de equipe, sem expor `users`.
5. **Comentários: um nível de respostas, texto simples, exclusão lógica.**
   Até 2.000 caracteres. O autor exclui o próprio comentário; a equipe exclui
   qualquer um, e o registro guarda quem excluiu e quando. Comentário excluído
   com respostas permanece como "comentário removido". Sem edição, denúncia,
   notificação ou tempo real nesta versão.
6. **Limite de taxa dentro da RPC.** Cerca de 10 criações por minuto por
   aluno, calculadas a partir das próprias linhas (`created_at` no último
   minuto), sem tabela extra. A equipe é isenta. O erro é um código distinto
   (`rate_limited`), decidido pelo cliente por `error.code`.
7. **Contrato espelhado.** Códigos de erro e limites (2.000 caracteres, taxa)
   ficam em `backend/contracts/studentArea.ts` e `frontend/src/contracts/
   studentArea.ts`, com teste de paridade, como nos contratos admin.

## Consequências

Positivas:

- Recomprar não pune o aluno: o progresso volta junto com o acesso.
- Nenhuma tabela de aluno é legível ou gravável diretamente pelo cliente;
  autorização e projeção de dados pessoais ficam em um só lugar (SQL).
- Percentual sempre consistente com o conteúdo atual, sem recálculo ou
  migração quando aulas são adicionadas, arquivadas ou removidas.
- Limite de taxa sem infraestrutura nova.

Negativas / custos:

- O percentual é calculado a cada leitura; pode exigir índice ou otimização
  se os cursos crescerem muito.
- Uma RPC a mais para manter e testar por operação; não há leitura genérica
  via PostgREST.
- Progresso de contas antigas permanece indefinidamente; a política de
  retenção LGPD continua adiada (ver ADR-0001), e agora cobre também
  progresso e comentários.
- Como a exclusão é lógica, comentários excluídos continuam contando para o
  limite de taxa; excluir e republicar não contorna o limite.
- Conclusão manual pode ser marcada sem assistir; aceito, pois a conclusão
  automática exigiria eventos de reprodução do Panda, ainda um stub.

## Alternativas rejeitadas

- **Progresso por matrícula:** rejeitada; cada recompra recomeçaria do zero e
  o aluno perderia o histórico justamente quando renova.
- **Percentual armazenado e atualizado por trigger:** rejeitada; fica
  desatualizado ao arquivar ou adicionar aulas e exige recálculo em massa.
- **Conclusão automática por tempo assistido:** adiada; depende de eventos
  de reprodução dos dois players e do Panda real. Pode ser somada depois sem
  mudar o modelo de dados.
- **Leitura direta com RLS:** rejeitada; não permite projetar só o primeiro
  nome e o indicador de equipe, nem calcular a árvore e o percentual em uma
  chamada, e repetiria a superfície que o ADR-0002 evitou.
- **Comentários abertos a quem tem pré-visualização gratuita:** rejeitada;
  amplia o alvo de spam e cria moderação sobre quem nunca comprou.
- **Respostas aninhadas sem limite:** rejeitada; complexidade de leitura e de
  interface sem ganho para o uso esperado (dúvidas e respostas da equipe).
- **Tabela de auditoria de moderação:** rejeitada por ora; `deleted_by` e
  `deleted_at` bastam, e a política de retenção ainda não existe.
- **Limite de taxa em tabela ou serviço próprio:** rejeitada; contagem das
  próprias linhas atende ao volume esperado.
