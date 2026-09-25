const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 8791;
const databasePath = path.resolve(`./backend/data/smoke-test-${process.pid}.sqlite`);
const env = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  DATABASE_PATH: databasePath,
  JWT_SECRET: 'smoke-test-secret-controle-densidade-32chars',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {}
    await wait(500);
  }
  throw new Error('Servidor de teste não iniciou no prazo esperado.');
}

async function request(path, options = {}) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.error?.message || 'erro'}`);
  return { ...body, __cookie: String(res.headers.get('set-cookie') || '').split(';')[0], __headers: res.headers };
}

(async () => {
  const server = spawn(process.execPath, ['--no-warnings', 'backend/src/server.js'], { env, stdio: 'inherit' });
  try {
    await waitForServer();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const failedLogin = await fetch(`http://127.0.0.1:${port}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bloqueio@sobral.local', senha: 'senha-incorreta' }),
      });
      const expectedStatus = attempt === 5 ? 429 : 401;
      if (failedLogin.status !== expectedStatus) throw new Error(`Bloqueio de login falhou na tentativa ${attempt}.`);
    }

    const loginProducao = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'producao@sobral.local', senha: 'producao123' }),
    });
    if (!loginProducao.usuario?.deveTrocarSenha) throw new Error('Troca da senha inicial nao foi exigida.');
    const remaining = loginProducao.sessaoExpiraEm - Date.now();
    if (remaining < 49 * 60 * 1000 || remaining > 51 * 60 * 1000) throw new Error('Sessao nao foi configurada para 50 minutos.');
    if (!/HttpOnly/i.test(loginProducao.__headers.get('set-cookie') || '') || !/SameSite=Strict/i.test(loginProducao.__headers.get('set-cookie') || '')) {
      throw new Error('Cookie de sessao sem protecoes esperadas.');
    }
    const producaoAlterada = await request('/api/change-password', {
      method: 'POST',
      cookie: loginProducao.__cookie,
      body: JSON.stringify({ senhaAtual: 'producao123', novaSenha: 'Producao#2026' }),
    });
    if (producaoAlterada.usuario?.deveTrocarSenha) throw new Error('Troca de senha da producao falhou.');

    const login = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@sobral.local', senha: 'admin123' }),
    });
    const adminAlterado = await request('/api/change-password', {
      method: 'POST',
      cookie: login.__cookie,
      body: JSON.stringify({ senhaAtual: 'admin123', novaSenha: 'Admin#Sobral2026' }),
    });
    const auth = { Cookie: adminAlterado.__cookie };

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
        senha: 'Smoke#Teste2026',
      }),
    });
    if (!novoUsuario.id || novoUsuario.perfil !== 'producao') {
      throw new Error('Cadastro de usuario nao retornou usuario valido.');
    }

    const usuarios = await request('/api/usuarios', { headers: auth });
    const adminAtual = usuarios.data.find((user) => user.perfil === 'administrador');
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
    await wait(350);
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(`${databasePath}${suffix}`, { force: true }); } catch {}
    }
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
