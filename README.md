# Controle de Densidade Sobral

Sistema web para controle de densidade e calculo de volume pela densidade.

## Requisitos

- Node.js 24 ou superior.
- Sem dependencias externas obrigatorias. O banco usa SQLite nativo do Node 24.

## Estrutura do projeto

```text
backend/
  src/       API, regras de negocio e persistencia
  data/      banco SQLite local
  scripts/   inicializacao, monitoramento e testes
  tools/     ponte de integracao biometrica
  vendor/    SDK do leitor biometrico
frontend/
  index.html
  app.js
  styles.css
docs/        documentacao complementar
tasks/       anotacoes de desenvolvimento
```

## Como executar

```bash
npm start
```

Acesse `http://localhost:8787`.

## Acesso

Por enquanto o sistema não tem tela de login: toda requisição usa um usuário
único com acesso full (perfil administrador), pensado para ser embutido dentro
do GESTÃO SBR, que cuidará do controle de acesso. Essa é uma decisão interina —
quando a integração com o GESTÃO SBR for definida, este ponto muda para usar a
identidade repassada por ele.

## Modulo Principal

A tela unica do sistema e a **carta de peso RQ 6308 — Volume pela Densidade**,
exibida exatamente como a planilha oficial (layout extraido do `.xlsm` por
`backend/tools/extrair-layout-rq6308.py` para `frontend/rq6308-layout.js`).

Como funciona:

- **Produtos** (`produtos_carta`): cadastro carregado de `backend/src/seeds/produtos.json`
  (66 produtos). Cada produto tem um **modelo de carta** (RQ/revisao, volume declarado,
  variacao, maquina, linha, balanca, frequencia). Produto sem modelo aparece como
  "modelo pendente" e ainda nao abre carta. Hoje so o 1101 (AGUALEMA SOBRAL 100 ML) tem modelo.
- **Cartas** (`cartas_peso`): a cada producao abre-se uma carta nova do produto, com o
  cabecalho do modelo; o operador informa o **lote** e faz toda a pesagem (taras ME1/ME2,
  densidades, 13 verificacoes, impresso/conferido). O preenchimento e salvo automaticamente.
- **Salvar carta** finaliza: a carta vai para o **historico do produto** e fica **imutavel**
  (a API recusa alteracao e triggers no SQLite bloqueiam `UPDATE`/`DELETE`). Uma carta nova,
  em branco, e aberta em seguida. Uma carta aberta por produto por vez.
- Historico por produto, com visualizacao somente leitura e exportacao em CSV e Excel (`.xlsx`).
- Toda gravacao fica registrada na tabela `auditoria` (antes/depois).
- A antiga tabela `controle_densidade` (carta unica de teste) foi mantida intacta.

## Variaveis

```bash
PORT=8787
HOST=127.0.0.1
JWT_SECRET=
COOKIE_SECURE=false
DATABASE_PATH=./backend/data/cartas-peso.sqlite
NODE_ENV=development
```

Quando `JWT_SECRET` não é informado ou ainda contém o valor inseguro de desenvolvimento, uma chave aleatória é criada em `backend/data/.jwt-secret`. Para acesso por HTTPS, configure `COOKIE_SECURE=true`. O host padrão `127.0.0.1` restringe o sistema ao computador local.

## Observacoes Tecnicas

- Backend em Node.js com `node:http` e `node:sqlite`.
- Frontend SPA em HTML/CSS/JavaScript nativo.
- Sem tela de login por enquanto (ver secao "Acesso") — `backend/src/auth.js` e a
  tabela `usuarios` continuam no repositorio, sem uso, como ponto de partida para
  quando a identidade vier do GESTÃO SBR.
- Dados do controle sao salvos como JSON estruturado no SQLite.
