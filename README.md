# Cartas de Peso Sobral

Sistema web para gerenciamento de cartas de peso e controle de volume por densidade para envase de suplementos líquidos e cosméticos.

## Requisitos

- Node.js 24 ou superior.
- Não há dependências externas obrigatórias nesta versão. O banco usa o SQLite nativo do Node 24.

## Como executar

```bash
npm start
```

Acesse `http://localhost:8787`.

## Acessos iniciais

- Administrador: `admin@sobral.local` / `admin123`
- Produção: `producao@sobral.local` / `producao123`
- Qualidade: `qualidade@sobral.local` / `qualidade123`

Troque as senhas antes de usar fora de ambiente de teste.

## Variáveis

Copie `.env.example` como referência:

```bash
PORT=8787
JWT_SECRET=troque-este-segredo-em-producao-com-no-minimo-32-caracteres
DATABASE_PATH=./data/cartas-peso.sqlite
NODE_ENV=development
```

## Funcionalidades

- Login com perfis de administrador, produção e qualidade.
- Tela de bloqueio multiusuário com aparência de computador industrial compartilhado.
- Login por PIN/senha alternativa e simulação de digital biométrica.
- Cadastro simulado de digital por usuário, preparado para futura integração por SDK/WebAuthn.
- Logs de acesso por usuário, método, status e dispositivo.
- Bloqueio manual e bloqueio automático configurável por inatividade.
- Assinatura eletrônica por PIN ou digital simulada em fechamento de carta.
- Cadastro de produtos com densidade, volumes, pesos brutos, variação e quantidade de amostras.
- Cadastro de embalagens.
- Cadastro de máquinas, linhas e balanças.
- Abertura de carta de peso com parâmetros herdados do produto e editáveis na API.
- Registro de coletas com até N amostras por carta.
- Cálculo automático de peso líquido e volume por densidade.
- Validação automática de limites de volume e peso bruto.
- Gráfico de volume médio por coleta com linhas de limite mínimo e máximo.
- Fechamento da carta pela qualidade/administração.
- Histórico de cartas e log de auditoria.
- Relatório imprimível com opção de salvar como PDF pelo navegador.

## Validação

```bash
npm run smoke
```

O teste sobe uma instância local em outra porta, autentica, cria uma carta, registra uma coleta e confere o resumo calculado.

## Observações técnicas

- Backend em Node.js usando `node:http` e `node:sqlite`.
- Frontend SPA em HTML/CSS/JavaScript nativo para reduzir dependências e facilitar execução em computador industrial.
- Os cálculos ficam centralizados em `src/calculos.js`.
- A camada `src/biometricService.js` concentra a biometria. A versão inicial é simulada e não armazena imagem de digital.
- Toda criação/alteração relevante grava auditoria na tabela `auditoria`.
- Para produção, configure `JWT_SECRET`, política de backup do SQLite ou migração para PostgreSQL, HTTPS e rotação de senhas.
