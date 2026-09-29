# Lições do projeto

- O instalador `npx agnostic-core@latest init` no Windows pode exigir Bash; neste ambiente funcionou pelo instalador PowerShell após `git init` e configuração de `safe.directory`.
- Dado "sumiu" do `controle_densidade`: consultar a tabela `auditoria` (antes/depois de cada PUT) ANTES de restaurar qualquer coisa. O usuário pode ter apagado de propósito pela tela; restaurar sem perguntar desfaz a ação dele.
- O sistema roda no Chrome do próprio usuário: pode haver abas dele abertas com versão antiga do app salvando no mesmo banco. Ao testar no navegador, interceptar os PUTs (ou usar dados de teste) e restaurar só o que eu mesmo alterei.
