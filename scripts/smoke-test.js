const { spawn } = require('node:child_process');

const port = 8791;
const env = {
  ...process.env,
  PORT: String(port),
  DATABASE_PATH: './data/smoke-test.sqlite',
  JWT_SECRET: 'smoke-test-secret-controle-densidade-32chars',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.error?.message || 'erro'}`);
  return body;
}

(async () => {
  const server = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { env, stdio: 'ignore' });
  try {
    await wait(1200);
    const lockUsers = await request('/api/lock/users');
    const adminUser = lockUsers.data.find((user) => user.perfil === 'administrador');
    const producaoUser = lockUsers.data.find((user) => user.perfil === 'producao');
    if (!adminUser) throw new Error('Usuario administrador nao encontrado.');
    if (!producaoUser) throw new Error('Usuario de producao nao encontrado.');

    const loginProducao = await request('/api/lock/auth', {
      method: 'POST',
      body: JSON.stringify({ usuarioId: producaoUser.id, metodo: 'pin', pin: 'producao123' }),
    });
    if (!loginProducao.token) throw new Error('Login por senha da producao falhou.');

    const login = await request('/api/lock/auth', {
      method: 'POST',
      body: JSON.stringify({ usuarioId: adminUser.id, metodo: 'pin', pin: 'admin123' }),
    });
    const auth = { Authorization: `Bearer ${login.token}` };

    const novoUsuario = await request('/api/usuarios', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        nome: 'Usuario Smoke',
        nomeExibicao: 'Smoke',
        matricula: 'SMK-001',
        setor: 'Producao',
        cargo: 'Operador',
        email: `smoke-${Date.now()}@sobral.local`,
        perfil: 'producao',
        status: 'ativo',
        senha: 'smoke123',
      }),
    });
    if (!novoUsuario.id || novoUsuario.perfil !== 'producao') {
      throw new Error('Cadastro de usuario nao retornou usuario valido.');
    }

    const usuarios = await request('/api/usuarios', { headers: auth });
    const adminAtual = usuarios.data.find((user) => user.id === adminUser.id);
    if (!adminAtual || Object.keys(adminAtual).some((key) => /biometric|digital/i.test(key))) {
      throw new Error('A API ainda expos dados de biometria.');
    }

    const controle = await request('/api/controle-densidade', { headers: auth });
    controle.cabecalho.lote = `SMOKE-${Date.now()}`;
    controle.verificacoes = [{
      id: 'smoke-1',
      realizadoPor: 'Smoke Test',
      data: '2026-06-12',
      hora: '10:00',
      pesos: [202.52, 202.5, 202.54, 202.51, 202.49, 202.53, 202.5, 202.52, 202.51, 202.5],
    }];

    await request('/api/controle-densidade', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(controle),
    });

    const salvo = await request('/api/controle-densidade', { headers: auth });
    if (salvo.verificacoes.length !== 1 || salvo.verificacoes[0].pesos.length !== 10) {
      throw new Error('Controle de densidade nao persistiu a verificacao.');
    }
    if (salvo.cabecalho.lote !== controle.cabecalho.lote) {
      throw new Error('Cabecalho editavel nao persistiu.');
    }

    console.log('Smoke test OK');
  } finally {
    server.kill('SIGTERM');
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
