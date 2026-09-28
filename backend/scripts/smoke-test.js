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
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.error?.message || 'erro'}`);
  return body;
}

(async () => {
  const server = spawn(process.execPath, ['--no-warnings', 'backend/src/server.js'], { env, stdio: 'inherit' });
  try {
    await waitForServer();

    const semCredencial = await fetch(`http://127.0.0.1:${port}/api/me`);
    if (!semCredencial.ok) throw new Error('/api/me deveria responder 200 sem exigir login.');
    const sessao = await semCredencial.json();
    if (!sessao.usuario || sessao.usuario.perfil !== 'administrador') {
      throw new Error('Usuario de acesso full nao foi retornado por /api/me.');
    }

    const antigasRotas = await Promise.all(
      ['/api/login', '/api/usuarios'].map((rota) => fetch(`http://127.0.0.1:${port}${rota}`, { method: 'POST' })),
    );
    if (antigasRotas.some((res) => res.status !== 404)) {
      throw new Error('Rotas de login/gestao de usuarios deveriam ter sido removidas (404).');
    }

    const controle = await request('/api/controle-densidade');
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
      body: JSON.stringify(controle),
    });

    const salvo = await request('/api/controle-densidade');
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
