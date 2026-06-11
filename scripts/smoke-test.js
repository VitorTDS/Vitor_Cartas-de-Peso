const { spawn } = require('node:child_process');

const port = 8791;
const env = {
  ...process.env,
  PORT: String(port),
  DATABASE_PATH: './data/smoke-test.sqlite',
  JWT_SECRET: 'smoke-test-secret-cartas-de-peso-32chars',
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
    const login = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@sobral.local', senha: 'admin123' }),
    });
    const auth = { Authorization: `Bearer ${login.token}` };
    const produtos = await request('/api/produtos', { headers: auth });
    const maquinas = await request('/api/maquinas-balancas', { headers: auth });
    const produto = produtos.data[0];
    const maquina = maquinas.data[0];
    const carta = await request('/api/cartas', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        produtoId: produto.id,
        lote: `SMOKE-${Date.now()}`,
        maquinaBalancaId: maquina.id,
        responsavelAbertura: 'Smoke Test',
        frequenciaMinutos: 30,
        toleranciaMinutos: 10,
      }),
    });
    await request(`/api/cartas/${carta.id}/coletas`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        numeroColeta: 1,
        responsavel: 'Smoke Test',
        data: '2026-06-11',
        hora: '10:00',
        taraEmbalagemG: 26,
        pesosBrutos: [229.1, 229.2, 229.3, 229.4, 229.5, 229.6, 229.7, 229.8, 229.9, 230.0],
      }),
    });
    const detalhe = await request(`/api/cartas/${carta.id}`, { headers: auth });
    if (detalhe.coletas.length !== 1 || !detalhe.resumo.totalAmostras) {
      throw new Error('Resumo da carta não foi calculado.');
    }
    console.log('Smoke test OK');
  } finally {
    server.kill('SIGTERM');
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
