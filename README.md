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

## Acessos iniciais

- Administrador: `admin@sobral.local` / `admin123`
- Producao: `producao@sobral.local` / `producao123`
- Qualidade: `qualidade@sobral.local` / `qualidade123`

Troque as senhas antes de usar fora de ambiente de teste.

No primeiro acesso, o sistema exige a troca da senha inicial. A sessão permanece ativa por 50 minutos e depois entra em suspensão, retornando automaticamente à tela de login.

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
- Login por senha para todos os perfis.
- Sessão protegida por cookie `HttpOnly` com duração de 50 minutos.
- Bloqueio temporário após cinco tentativas incorretas de login.
- Troca obrigatória da senha inicial.
- Cadastro de novos usuarios pelo administrador.

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
- A autenticacao existente foi mantida para controle de acesso.
- Dados do controle sao salvos como JSON estruturado no SQLite.
