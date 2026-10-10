# Especificação de UI

Status: aprovada (tema claro); itens em aberto na seção 9. Fontes: Manual de Identidade Visual do Regnum Christi
(setembro de 2017) e três capturas de tela de referência da área do aluno.

## 1. Referências

| Referência | Caminho | O que mostra | Como usar |
|---|---|---|---|
| Manual de identidade visual | `docs/ui/referencias/Manual-Identidad-Visual-Regnum-Christi-septiembre-2017.pdf` | Logotipo, tipografia, cores, imagens (páginas 5 a 24) | Fonte normativa de marca. Prevalece sobre as capturas. |
| Área do aluno 1 | `frontend/examples/exemplo-area-alunos-1.png` | Site institucional do Regnum Christi Brasil (cabeçalho branco, destaques em grade, rótulo "BLOG") | Referência de tom de marca e de cabeçalho. A grade de cursos comprados do aluno segue este tom, não o tema escuro. |
| Área do aluno 2 | `frontend/examples/exemplo-area-alunos-2.png` | Home de um curso: título, descrição, duração, progresso, "continuar de onde parei", módulos recolhíveis com aulas, duração, status e nota | Referência de estrutura e de comportamento da página do curso. |
| Área do aluno 3 | `frontend/examples/exemplo-area-alunos-3.png` | Aula: vídeo, lista lateral de aulas, trilha de navegação, descrição, materiais complementares, avaliação, "marcar como concluído", progresso | Referência de estrutura e de comportamento da página da aula. |

Regra de precedência: as capturas 2 e 3 pertencem a outra plataforma (tema escuro, marca
própria). Delas se copia estrutura, hierarquia e comportamento. Cores, tipografia e logotipo
vêm só do manual.

## 2. Princípios de marca (manual, A5)

- Respirar em branco, matizar em cinza e sinalizar em vermelho. O fundo padrão é branco.
- O vermelho institucional é pontual: nunca pintar tudo de vermelho nem abusar de fundos
  vermelhos. Em superfícies grandes ou títulos usar a variante mais sóbria (Pantone 194).
- Cinza Cool Gray 11 para títulos, parágrafos e texto legal.
- Imagens brilhantes, de realidades cotidianas, sem aparência artificial (A6).

## 3. Logotipo (manual, A3)

- Três versões: horizontal, vertical com letras em uma linha, vertical com letras em duas
  linhas. No cabeçalho da plataforma usar a **horizontal**.
- Sobre fundo claro: versão em cores. Sobre fundo escuro: versão em cores com as letras em
  branco (ou a versão de linhas com a cruz em branco).
- Tamanho mínimo: 2 cm x 1 cm em impressão (equivale a cerca de 76 x 38 px a 96 dpi); letras
  nunca abaixo de 6 pt.
- Área de proteção: a altura da letra "C" do letragrama em todos os lados.
- Proibido: distorcer, alongar ou achatar, reduzir um elemento sem proporção, afastar o
  escudo das letras, mover elementos, trocar cores.
- O ramo laico usa o logotipo do Regnum Christi. As versões de Legionários de Cristo e
  Consagradas só entram se houver curso próprio desses ramos.
- Os arquivos de logotipo não vêm no manual como vetor. Pendência: obter SVG oficial (ver
  seção 9).

## 4. Cores

Tokens a definir em `:root` em `frontend/src/index.css` (hoje o arquivo usa a paleta
roxa do template do Vite, que deve ser substituída).

| Token | Valor | Origem no manual | Uso |
|---|---|---|---|
| `--color-brand` | `#91152b` | Vermelho Pantone 187 C | Ação primária, escudo, indicador de progresso, links ativos |
| `--color-brand-strong` | `#941a2c` | Pantone 194 C | Títulos destacados, superfícies maiores, hover da ação primária |
| `--color-brand-web` | `#990000` | Cor usada na web institucional | Reserva; só se o 194 ficar fraco em uso real |
| `--color-ink` | `#474b50` | Cool Gray 11 (R71 G75 B80) | Texto de títulos e parágrafos |
| `--color-ink-strong` | `#000000` | Negro | Uso raro, ênfase de maior contraste |
| `--color-surface` | `#ffffff` | Blanco | Fundo da página e dos cartões |
| `--color-surface-muted` | `#f2f2f2` | Gama de grises (K 5, derivado) | Fundo de seções, linhas alternadas |
| `--color-line` | `#d4d4d4` | Gama de grises (K 20) | Bordas e divisores |
| `--color-ink-soft` | `#8f8f8f` | Gama de grises (K 50) | Texto auxiliar, ícones inativos (somente texto grande ou decorativo) |

Observações:

- `#91152b` é o valor HTML que o manual publica para o vermelho 187; o RGB de tela do mesmo
  manual (R166 G25 B46, `#a6192e`) é um pouco mais vivo. Usar `#91152b` por ser o valor HTML
  oficial. O manual avisa que o 187 vivo pode ficar estridente em telas.
- `--color-ink-soft` e `--color-line` são derivados da gama de cinzas (o manual não publica
  hexadecimais para K 50 e K 20). Validar contraste antes de usar como texto.
- Estados semânticos (sucesso, erro, aviso) não existem no manual. Proposta: sucesso
  `#2e7d32`, erro reaproveita `--color-brand-strong`, aviso `#b26a00`. Confirmar com a marca.
- Contraste mínimo WCAG AA: 4.5:1 para texto, 3:1 para texto grande e componentes. `#474b50`
  e `#91152b` sobre branco passam com folga.
- Tema escuro: fora do escopo desta versão. O manual orienta fundo branco; as capturas 2 e 3
  usam tema escuro por serem de outra plataforma (ver decisões em aberto).

## 5. Tipografia (manual, A4)

- Família corporativa: Helvetica Neue (Light, Regular, Medium, Bold). Em web, o manual
  autoriza substituir por **Arial** ou **Calibri**.
- Pilha proposta:
  `--font-sans: 'Helvetica Neue', Helvetica, Arial, sans-serif;`
  Sem webfont: Helvetica Neue é licenciada e o manual aceita Arial em web, então nada é
  carregado da rede.
- Parágrafos sempre alinhados à esquerda, sem justificar.
- Itálico só em caráter excepcional (estrangeirismos, termos usados impropriamente).
- Pesos: 300 para texto grande e subtítulos, 400 para corpo, 500 para rótulos e títulos de
  seção, 700 para títulos principais.

Escala proposta (rem, base 16 px):

| Papel | Tamanho | Peso | Cor |
|---|---|---|---|
| Título de página (h1) | 1.75 | 700 | `--color-ink` |
| Título de seção (h2) | 1.25 | 500 | `--color-ink` |
| Destaque pontual | 1.25 | 700 | `--color-brand-strong` |
| Corpo | 1 | 400 | `--color-ink` |
| Texto auxiliar (duração, metadados) | 0.8125 | 400 | `--color-ink` com opacidade reduzida, nunca abaixo de 4.5:1 |
| Rótulo de botão | 0.9375 | 500 | conforme variante |

O letragrama "Regnum Christi" (Trajan Pro modificado) faz parte do logotipo e nunca é
digitado como texto.

## 6. Componentes e padrões

### 6.1 Cabeçalho

Fundo branco, sombra leve inferior, logotipo horizontal à esquerda respeitando a área de
proteção, navegação em cinza Cool Gray 11 com item ativo em `--color-brand`. Referência:
captura 1.

### 6.2 Botões

- Primário: fundo `--color-brand`, texto branco. Hover em `--color-brand-strong`.
- Secundário: contorno `--color-brand`, texto `--color-brand`, fundo branco.
- Terciário: texto `--color-ink`, sem contorno.
- Foco visível em todos (anel de 2 px em `--color-brand` com deslocamento).
- Alvos de toque de pelo menos 44 px de altura em mobile.

### 6.3 Página inicial do aluno (captura 1, tom institucional)

- Grade de cartões com todos os cursos comprados: imagem de capa, título, barra de progresso
  e ação "Continuar". Sem curso: estado vazio com chamada para o catálogo.
- Cartões brancos com borda `--color-line`; destaque em vermelho só no progresso e na ação.

### 6.4 Página do curso (captura 2)

- Coluna lateral com título, descrição curta, duração total, quantidade de conteúdos, barra de
  progresso com percentual e o botão "Continuar de onde parei" (leva à próxima aula não
  concluída).
- Coluna principal com os módulos em cartões recolhíveis (todos expandidos por padrão; o
  estado recolhido não persiste nesta versão). Cabeçalho do módulo: título e, se houver,
  subtítulo.
- Linha da aula: ícone de estado, título, duração, e à direita o controle de nota quando
  houver avaliação. Estados do ícone: não iniciada (play), concluída (check), em andamento
  (play com anel). Concluída não depende só da cor: o ícone muda de forma.
- Aulas arquivadas não aparecem para o aluno.
- Mobile: coluna lateral vai para cima, módulos em largura total.

### 6.5 Página da aula (captura 3)

- Área do player em 16:9 com a lista de aulas do módulo ao lado em telas largas; em mobile a
  lista vai abaixo do player.
- Trilha de navegação: Curso > Módulo, com links.
- Ações: aula anterior, próxima aula.
- Abaixo do player: título, descrição, materiais complementares (nome, tipo, tamanho, ação de
  baixar).
- Painel lateral: avaliação do conteúdo em cinco níveis, botão "Marcar como concluído" e a
  barra de progresso do curso.
- Comentários: previstos pela referência, sem modelo de dados hoje. Fora desta versão (ver
  seção 8).

### 6.6 Administração (`/admin`)

Segue o mesmo sistema de tokens. As telas de `/admin/courses` já implementadas usam
estilos locais (`CourseForm.module.css`) e devem migrar para os tokens quando estes
existirem, sem mudar comportamento.

## 7. Imagens e ícones

- Fotografias brilhantes, de situações cotidianas, enquadramentos de instante capturado.
  Evitar bancos de imagem com aparência produzida (manual A6).
- Capas de curso: proporção 16:9, com o mesmo tratamento em todo o catálogo.
- Ícones de traço simples, 1.5 px, na cor do texto; vermelho só para estado ativo.

## 8. Acessibilidade e responsividade

- Contraste AA, foco visível, ordem de tabulação seguindo a leitura, nomes acessíveis em
  ícones, `prefers-reduced-motion` respeitado.
- Pontos de quebra propostos: 640 px (mobile), 1024 px (desktop). Mobile primeiro.
- Idioma da interface: português do Brasil.

## 9. Decisões

Fechadas:

1. **Tema:** claro, conforme o manual. Tema escuro fora de escopo.
2. **Vermelho primário:** `#91152b` (valor HTML do 187).
3. **Estados semânticos:** valores da seção 4 aceitos como propostos; a confirmar com a marca se necessário.
4. **Fonte:** pilha de sistema Helvetica Neue, Helvetica, Arial, sem licenciar webfont.

Em aberto:

1. **Logotipo:** o arquivo oficial (SVG, versão horizontal e versão para fundo escuro) será
   fornecido depois. Até lá o cabeçalho usa um espaço reservado.
2. **Recursos sem modelo de dados:** comentários, avaliação com nota, materiais
   complementares e progresso por aula serão especificados depois, cada um em ticket próprio.

## 10. Próximos passos sugeridos

1. Validar esta especificação e fechar as decisões 1, 2 e 6.
2. Implementar os tokens em `frontend/src/index.css` e a pilha tipográfica.
3. Adicionar o logotipo ao cabeçalho.
4. Fatiar em tickets: home do aluno, página do curso, página da aula, migração do `/admin`
   para os tokens.
