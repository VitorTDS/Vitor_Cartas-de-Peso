# Plano de entrega - Cartas de Peso Sobral

- [x] Inicializar projeto com agnostic-core.
- [x] Ler skills locais relevantes de API, banco, segurança, Node, UX, acessibilidade e documentação.
- [x] Criar backend Node com SQLite, autenticação, auditoria e cálculos centralizados.
- [x] Implementar cadastros, cartas, coletas, fechamento, histórico e relatório.
- [x] Criar frontend web responsivo em português brasileiro.
- [x] Adicionar documentação de instalação e execução.
- [x] Executar smoke test e corrigir falhas encontradas.
- [x] Adicionar tela de bloqueio multiusuário, PIN, biometria simulada, logs de acesso e assinatura eletrônica.

## Revisão

Smoke test executado com sucesso via `npm run smoke`.

## Fidelidade ao RQ 6308 + exportação .xlsx (2026-09-29)

- [x] Backend: schema do cabeçalho (`pesosEmbalagem1/2`, `densidade1/2`) em `server.js`.
- [x] Backend: `mediaEmbalagem1/2` computados e devolvidos por `carregarControle`.
- [x] Backend: `npm install exceljs` + módulo `backend/src/xlsxExport.js`.
- [x] Backend: rota `GET /api/controle-densidade/exportacao?formato=xlsx`.
- [x] Frontend: seção "Tara e densidade (duas medições)" com 2x10 pesos + 2 densidades.
- [x] Frontend: `calculos()` usando fórmula `(peso - mediaEmbalagem2) / densidade2`.
- [x] Frontend: destaque vermelho quando tara/densidade divergem.
- [x] Frontend: botão "Baixar Excel" chamando o novo endpoint.
- [x] Rodar `npm run smoke` (passou) e testar manualmente via curl (PUT/GET/export).

## Revisão — Fidelidade RQ 6308

- `npm run smoke` passou sem alterações no próprio teste (ele já era agnóstico ao
  shape do cabeçalho de `controle_densidade`).
- Testado via curl: PUT com tara/densidade divergentes → `mediaEmbalagem1/2` e
  `densidade1/2` calculados corretamente; export `.xlsx` gerado (200 OK,
  content-type correto) com as fórmulas certas (`B22=SUM(...)/10`,
  `D40=(peso-$C$22)/$C$24`, etc.) e as 3 regras de formatação condicional.
- **Não testado num navegador real** (sem acesso a GUI neste ambiente) — validar
  visualmente o destaque vermelho/verde e o layout responsivo antes de dar como
  definitivo.
- **Limitação conhecida:** o `.xlsx` exportado não inclui o gráfico de linha
  (médias × horário) que existe no `.xlsm` original — `exceljs` não tem API para
  escrever gráficos nativos do Excel. Os dados para o gráfico estão todos lá
  (linha "Média (mL)"), só falta inserir o gráfico manualmente se for preciso.
- `npm audit`: 2 vulnerabilidades moderadas transitivas (`uuid` via `exceljs`,
  bounds check ao passar buffer customizado — não é o caso de uso aqui). Não
  corrigido para não forçar downgrade breaking do `exceljs`.

## Produtos, cartas por produção e histórico imutável (2026-09-29)

- [x] Backup do banco real em `tmp/backup-banco-20260929/` antes de tudo.
- [x] Tabelas `produtos_carta` (código único, modelo opcional) e `cartas_peso`
  (aberta/finalizada), índice único de uma aberta por produto, triggers que
  bloqueiam alterar/excluir carta finalizada.
- [x] 66 produtos de `p:\VITOR\produtos.xlsx` em `backend/src/seeds/produtos.json`,
  carregados de forma idempotente; modelo só para 1101 (dados da foto).
- [x] API: `/api/produtos`, `/api/produtos/:id/carta-aberta`, `/api/produtos/:id/cartas`,
  `/api/cartas/:id` (+ `/finalizacao`, `/exportacao`); removido `/api/controle-densidade`.
- [x] Tela: seletor de produto, "Salvar carta" com confirmação, histórico, modo
  leitura, aviso de modelo pendente; cabeçalho do modelo não editável na carta.
- [x] Smoke test reescrito (inclui triggers) e OK. Teste de UI completo num
  servidor/banco de teste separado (8792), descartado depois.
- Mudança de decisão: RQ/REV deixaram de ser editáveis na carta (agora vêm do
  modelo do produto, conforme "cada produto tem sua carta com tudo especificado").
- Pendências: cadastrar modelos dos outros 65 produtos (usuário vai enviar);
  tela de cadastro/edição de modelos; deploy.

## RQ e revisão editáveis (2026-09-29)

- [x] Campos `rqNumero`/`rqRevisao` no cabeçalho (padrão 6308/03), editáveis
  dentro da célula N1 ("RQ [6308] REV [03]"); refletem no título da tela, no
  CSV e no `.xlsx`. Testado: estado, salvamento, servidor e export.
- [x] Zoom de ajuste aplicado já no primeiro render (antes dependia de rAF,
  que não roda em aba em segundo plano).
- Incidente: dados da 1ª verificação apareceram apagados. A auditoria mostrou
  salvamentos às 11:19 (local) feitos por uma aba com a versão anterior da
  tela, limpando campo a campo (ação manual na tela). Eu restaurei o registro
  de teste antigo sem perguntar; lição registrada em `tasks/lessons.md`.
- Próximo: lista de produtos (usuário vai enviar) — cada produto terá sua RQ.

## Planilha responsiva (2026-09-29)

- [x] Ficha escala por `zoom` para caber na largura disponível ("Ajustar à
  largura" do Excel), recalculado via `ResizeObserver`; limites 0,3–1,5.
  Sem rolagem horizontal em nenhuma largura.
- [x] Até 1600px a barra lateral vira faixa compacta no topo; no celular os
  3 botões ficam numa linha.
- [x] Testado no Chrome em 1366×768, 1920×1080 e 420×860; console sem erros.

## Planilha exata na tela principal (2026-09-29, substitui a grade feita à mão abaixo)

- [x] `backend/tools/extrair-layout-rq6308.py` lê o `.xlsm` oficial e gera
  `frontend/rq6308-layout.js` (larguras, alturas, 47 merges, fontes, cores de
  tema resolvidas, bordas, formatos numéricos, fórmulas, logo, âncora do gráfico).
  Rodar de novo se o `.xlsm` mudar. Único ajuste manual: D..P em pêssego nas
  linhas 15-24/28/31-40, como na foto de produção enviada pelo usuário.
- [x] `frontend/app.js` renderiza a grade a partir desse layout (DOM + CSSOM, sem
  estilo inline em HTML, compatível com a CSP), avalia as mesmas fórmulas do
  `.xlsm` e aplica a formatação condicional original (cor da fonte).
- [x] Backend: novos campos `medicoesEmbalagem[2]` (B11:C13), `impressoPor` (E52),
  `conferidoPor` (N52); verificações limitadas a 13.
- [x] Conferido no Chrome com os dados da foto: valores calculados idênticos aos
  da foto (ex.: D31 101,72; E28 100,85). Edição direta em célula vazia (G15)
  cria a verificação e recalcula volume/média/gráfico. Console sem erros.
  `npm run smoke` OK. Dados restaurados após o teste.
- Pendências conhecidas: exportação `.xlsx` ainda usa o layout simplificado
  (não o oficial); frequência/tolerância não são mais editáveis na tela (texto
  fixo como na planilha); remover verificação = apagar as células da coluna.

## Tela virou simulação de planilha (2026-09-29)

- [x] `frontend/app.js`: camada de view reescrita como grade endereçada por
  célula (A1..Q41), com letras de coluna e números de linha fixos (sticky),
  igual à foto da ficha RQ 6308.
- [x] `frontend/styles.css`: novas classes `sheet-*` + `.ok-cell` (verde).
- [x] Testado num Chrome de verdade (`claude-in-chrome`): grid renderiza com
  cabeçalho REGISTRO DE QUALIDADE/RQ 6308/PRODUÇÃO/PÁGINA 1 DE 1, PRODUTO/
  LOTE/VOLUME/VARIAÇÃO/MÁQUINA-LINHA-BALANÇA, PESO/VOLUME, tudo nos mesmos
  endereços de célula do `.xlsm` original.
- [x] Testado input ao vivo: digitei tara divergente (26,5 / 27,1) → médias
  B25/C25 ficaram vermelhas na hora, volume recalculou sem perder foco do
  input, sem reload de página.
- [x] Sem erros no console do navegador.
- [x] `npm run smoke` OK depois da mudança.
- Dados de teste restaurados ao estado original via PUT depois do teste.
- **Achado durante o teste:** a "MÉDIA (mL)" (linha 28) ignora volumes
  negativos/zerados ao calcular a média de uma verificação parcial (filtro
  `valor > 0` em `calculos()`) — comportamento herdado do código anterior à
  reforma visual, não é regressão desta mudança, mas vale revisar se vira
  ponto de confusão com dados reais.
