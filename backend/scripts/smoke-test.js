const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

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

function afirmar(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
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

async function chamar(caminho, options = {}) {
  const res = await fetch(`http://localhost:${port}${caminho}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function request(caminho, options = {}) {
  const { status, body } = await chamar(caminho, options);
  if (status >= 400) throw new Error(`${status} ${caminho}: ${body.error?.message || 'erro'}`);
  return body;
}

(async () => {
  const server = spawn(process.execPath, ['--no-warnings', 'backend/src/server.js'], { env, stdio: 'inherit' });
  let cartaFinalizadaId;
  try {
    await waitForServer();

    const sessao = await request('/api/me');
    afirmar(sessao.usuario?.perfil === 'administrador', 'Usuario de acesso full nao foi retornado por /api/me.');

    const antigas = await Promise.all(
      ['/api/login', '/api/usuarios'].map((rota) => fetch(`http://127.0.0.1:${port}${rota}`, { method: 'POST' })),
    );
    afirmar(antigas.every((res) => res.status === 404), 'Rotas de login/gestao de usuarios deveriam ter sido removidas (404).');

    // Cadastro de produtos
    const { data: produtos } = await request('/api/produtos');
    const cadastro = JSON.parse(fs.readFileSync('backend/src/seeds/produtos.json', 'utf8')).produtos;
    afirmar(produtos.length === cadastro.length, `Esperados ${cadastro.length} produtos, vieram ${produtos.length}.`);
    const agua100 = produtos.find((p) => p.codigo === '1101');
    afirmar(agua100?.modeloPronto, 'Agualema 100 ML (1101) deveria ter modelo de carta.');
    const semModelo = produtos.find((p) => !p.modeloPronto);
    const pendente = await chamar(`/api/produtos/${semModelo.id}/cartas`, { method: 'POST' });
    afirmar(pendente.status === 422, 'Produto sem modelo não deveria abrir carta.');

    // Abrir carta
    const semAberta = await chamar(`/api/produtos/${agua100.id}/carta-aberta`);
    afirmar(semAberta.status === 404, 'Produto novo não deveria ter carta aberta.');
    const carta = await request(`/api/produtos/${agua100.id}/cartas`, { method: 'POST' });
    afirmar(carta.status === 'aberta' && carta.cabecalho.lote === '', 'Carta nova deveria nascer aberta e sem lote.');
    afirmar(carta.cabecalho.rqNumero === '6308' && carta.cabecalho.volumeDeclaradoMl === 100, 'Carta nova deveria vir com o cabeçalho do produto.');
    afirmar(carta.cabecalho.densidadeProdutoGml === 1.0066 && carta.cabecalho.pesoEmbPrimariaG === 16.93, 'Carta nova deveria vir com densidade e peso emb. primaria do produto.');
    const duplicada = await chamar(`/api/produtos/${agua100.id}/cartas`, { method: 'POST' });
    afirmar(duplicada.status === 409, 'Não deveria abrir segunda carta do mesmo produto.');

    // Autosave: cabeçalho do produto não pode ser trocado pelo cliente
    carta.cabecalho.lote = 'SMOKE-001';
    carta.cabecalho.volumeDeclaradoMl = 999;
    carta.cabecalho.densidadeProdutoGml = 5;
    carta.cabecalho.pesoEmbPrimariaG = 99;
    carta.cabecalho.pesosEmbalagem2 = [16.93, 16.93, 16.93, 16.93, 16.93, 16.93, 16.93, 16.93, 16.93, 16.93];
    carta.cabecalho.densidade2 = 1.0066;
    carta.verificacoes = [{ id: 'v1', realizadoPor: 'Smoke', data: '2026-04-28', hora: '07:51', pesos: [119.32, 0, 0, 0, 0, 0, 0, 0, 0, 0] }];
    const salva = await request(`/api/cartas/${carta.id}`, { method: 'PUT', body: JSON.stringify(carta) });
    afirmar(salva.cabecalho.lote === 'SMOKE-001', 'Lote nao foi salvo.');
    afirmar(salva.cabecalho.volumeDeclaradoMl === 100, 'Cabecalho do produto foi alterado pelo cliente.');
    afirmar(salva.cabecalho.densidadeProdutoGml === 1.0066 && salva.cabecalho.pesoEmbPrimariaG === 16.93, 'Densidade/peso emb. do produto foram alterados pelo cliente.');
    afirmar(salva.verificacoes[0].pesos[0] === 119.32, 'Pesagem nao foi salva.');

    // Salvar exige lote
    const semLote = await chamar(`/api/cartas/${carta.id}/finalizacao`, {
      method: 'POST',
      body: JSON.stringify({ ...salva, cabecalho: { ...salva.cabecalho, lote: '' } }),
    });
    afirmar(semLote.status === 422, 'Salvar sem lote deveria ser recusado.');

    // Salvar (finalizar) e imutabilidade pela API
    const finalizada = await request(`/api/cartas/${carta.id}/finalizacao`, { method: 'POST', body: JSON.stringify(salva) });
    cartaFinalizadaId = finalizada.id;
    afirmar(finalizada.status === 'finalizada' && finalizada.finalizadaEm, 'Carta nao foi finalizada.');
    afirmar((await chamar(`/api/cartas/${carta.id}`, { method: 'PUT', body: JSON.stringify(salva) })).status === 409, 'Carta salva nao poderia ser alterada.');
    afirmar((await chamar(`/api/cartas/${carta.id}/finalizacao`, { method: 'POST', body: '{}' })).status === 409, 'Carta salva nao poderia ser salva de novo.');

    // Próxima produção: carta nova em branco com o mesmo cabeçalho
    const proxima = await request(`/api/produtos/${agua100.id}/cartas`, { method: 'POST' });
    afirmar(proxima.id !== carta.id && proxima.cabecalho.lote === '' && proxima.verificacoes.length === 0, 'Carta nova deveria nascer em branco.');
    afirmar(proxima.cabecalho.tagBalanca === 'BAL-501004', 'Carta nova deveria manter o cabeçalho do produto.');

    // Histórico
    const { data: historico } = await request(`/api/produtos/${agua100.id}/cartas?status=finalizada`);
    afirmar(historico.length === 1 && historico[0].lote === 'SMOKE-001', 'Historico deveria listar a carta salva.');
    const reaberta = await request(`/api/cartas/${carta.id}`);
    afirmar(reaberta.verificacoes[0].pesos[0] === 119.32, 'Carta do historico perdeu dados.');

    const exportacao = await fetch(`http://127.0.0.1:${port}/api/cartas/${carta.id}/exportacao?formato=xlsx`);
    afirmar(exportacao.ok && exportacao.headers.get('content-type').includes('spreadsheetml'), 'Exportacao xlsx da carta falhou.');
  } finally {
    server.kill('SIGTERM');
    await wait(350);
  }

  try {
    // Imutabilidade no próprio banco (triggers), mesmo sem passar pela API
    const db = new DatabaseSync(databasePath);
    let bloqueouUpdate = false;
    let bloqueouDelete = false;
    try { db.prepare("UPDATE cartas_peso SET lote = 'ADULTERADO' WHERE id = ?").run(cartaFinalizadaId); } catch { bloqueouUpdate = true; }
    try { db.prepare('DELETE FROM cartas_peso WHERE id = ?').run(cartaFinalizadaId); } catch { bloqueouDelete = true; }
    db.close();
    afirmar(bloqueouUpdate, 'Banco permitiu alterar carta finalizada.');
    afirmar(bloqueouDelete, 'Banco permitiu excluir carta.');
    console.log('Smoke test OK');
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(`${databasePath}${suffix}`, { force: true }); } catch {}
    }
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
