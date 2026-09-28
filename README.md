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

A tela unica do sistema e o modulo **Controle de Densidade - Volume pela Densidade**.

Recursos implementados:

- Cabecalho editavel com produto, lote, volume declarado, variacao permitida, densidade, peso da embalagem primaria, minimo/maximo, maquina, linha, balanca, frequencia e tolerancia.
- Tabela de pesagens com colunas dinamicas por verificacao.
- Cada verificacao registra realizado por, data, hora e 10 pesos.
- Calculo automatico em tempo real de media, densidade e MEDIA (mL).
- Edicao manual de qualquer peso com recalculo imediato.
- Formatacao condicional em vermelho para densidade ou volume fora da faixa permitida.
- Persistencia no SQLite pela tabela `controle_densidade`.
- Exportacao em CSV e Excel (`.xls`).

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
