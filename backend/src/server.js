const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { migrate, all, get, run, auditar, db } = require('./db');
const { gerarPlanilhaControleDensidade } = require('./xlsxExport');

const publicDir = path.resolve(__dirname, '..', '..', 'frontend');

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function erro(res, status, code, message, details = [], headers = {}) {
  json(res, status, { error: { code, message, details } }, headers);
}

function lerBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > config.maxBodyBytes) {
        rejected = true;
        const err = new Error('Payload muito grande.');
        err.status = 413;
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (rejected) return;
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
  });
}

const USUARIO_SISTEMA = { id: null, nome: 'Sistema', nomeExibicao: 'Sistema', perfil: 'administrador', status: 'ativo' };

function usuarioAtual() {
  const row = get('SELECT * FROM usuarios WHERE perfil = ? ORDER BY id LIMIT 1', ['administrador']);
  return row ? mapUsuario(row) : USUARIO_SISTEMA;
}

function exigir(req, res, perfis = []) {
  const usuario = usuarioAtual();
  if (perfis.length && !pode(usuario.perfil, perfis)) {
    erro(res, 403, 'FORBIDDEN', 'Seu perfil não tem permissão para esta ação.');
    return null;
  }
  return usuario;
}

function pode(perfil, perfis) {
  if (perfil === 'administrador') return true;
  if (perfis.includes(perfil)) return true;
  if (perfil === 'supervisor' && (perfis.includes('producao') || perfis.includes('qualidade'))) return true;
  return false;
}

function texto(body, campo, obrigatorio = true) {
  const valor = String(body[campo] ?? '').trim();
  if (obrigatorio && !valor) throw new Error(`Campo obrigatório: ${campo}`);
  return valor;
}

function mapUsuario(row) {
  return row && {
    id: row.id,
    nome: row.nome,
    nomeExibicao: row.nome_exibicao || row.nome,
    matricula: row.matricula || '',
    setor: row.setor || '',
    cargo: row.cargo || '',
    email: row.email,
    perfil: row.perfil,
    status: row.status,
    avatarUrl: row.avatar_url || '',
    ultimoAcesso: row.ultimo_acesso,
    criadoEm: row.criado_em,
    deveTrocarSenha: Boolean(row.deve_trocar_senha),
  };
}

function controlePadrao() {
  return {
    cabecalho: {
      produto: 'AGUALEMA SOBRAL 200 ML',
      lote: '260227',
      volumeDeclaradoMl: 200,
      variacaoPermitidaPercentual: 1,
      pesosEmbalagem1: Array.from({ length: 10 }, () => 0),
      pesosEmbalagem2: Array.from({ length: 10 }, () => 0),
      medicoesEmbalagem: [
        { realizadoPor: '', data: '', hora: '' },
        { realizadoPor: '', data: '', hora: '' },
      ],
      densidade1: 1.0126,
      densidade2: 1.0126,
      minimoMl: 200,
      maximoMl: 202,
      maquinaTag: 'ECH-501013',
      linha: '',
      tagBalanca: 'BAL-501004',
      frequenciaMinutos: 30,
      toleranciaMinutos: 10,
      impressoPor: '',
      conferidoPor: '',
    },
    verificacoes: [],
  };
}

function normalizarControle(body) {
  const atual = controlePadrao();
  const cabecalho = { ...atual.cabecalho, ...(body.cabecalho || {}) };
  const numero = (valor, fallback) => {
    const parsed = Number(String(valor).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const pesosDez = (valor) => Array.from({ length: 10 }, (_, index) => numero(valor?.[index], 0));
  const media = (pesos) => pesos.reduce((soma, valor) => soma + valor, 0) / 10;
  const volumeDeclaradoMl = numero(cabecalho.volumeDeclaradoMl, atual.cabecalho.volumeDeclaradoMl);
  const variacaoPermitidaPercentual = numero(cabecalho.variacaoPermitidaPercentual, atual.cabecalho.variacaoPermitidaPercentual);
  const pesosEmbalagem1 = pesosDez(cabecalho.pesosEmbalagem1);
  const pesosEmbalagem2 = pesosDez(cabecalho.pesosEmbalagem2);
  return {
    cabecalho: {
      produto: texto(cabecalho, 'produto', false) || atual.cabecalho.produto,
      lote: texto(cabecalho, 'lote', false),
      volumeDeclaradoMl,
      variacaoPermitidaPercentual,
      pesosEmbalagem1,
      pesosEmbalagem2,
      medicoesEmbalagem: [0, 1].map((index) => {
        const item = Array.isArray(cabecalho.medicoesEmbalagem) ? cabecalho.medicoesEmbalagem[index] || {} : {};
        return {
          realizadoPor: texto(item, 'realizadoPor', false),
          data: texto(item, 'data', false),
          hora: texto(item, 'hora', false),
        };
      }),
      mediaEmbalagem1: media(pesosEmbalagem1),
      mediaEmbalagem2: media(pesosEmbalagem2),
      densidade1: numero(cabecalho.densidade1, atual.cabecalho.densidade1),
      densidade2: numero(cabecalho.densidade2, atual.cabecalho.densidade2),
      minimoMl: volumeDeclaradoMl,
      maximoMl: volumeDeclaradoMl * (1 + variacaoPermitidaPercentual / 100),
      maquinaTag: texto(cabecalho, 'maquinaTag', false),
      linha: texto(cabecalho, 'linha', false),
      tagBalanca: texto(cabecalho, 'tagBalanca', false),
      frequenciaMinutos: numero(cabecalho.frequenciaMinutos, atual.cabecalho.frequenciaMinutos),
      toleranciaMinutos: numero(cabecalho.toleranciaMinutos, atual.cabecalho.toleranciaMinutos),
      impressoPor: texto(cabecalho, 'impressoPor', false),
      conferidoPor: texto(cabecalho, 'conferidoPor', false),
    },
    verificacoes: Array.isArray(body.verificacoes) ? body.verificacoes.slice(0, 13).map((item) => ({
      id: texto(item, 'id', false) || String(Date.now()),
      realizadoPor: texto(item, 'realizadoPor', false),
      data: texto(item, 'data', false),
      hora: texto(item, 'hora', false),
      pesos: pesosDez(item.pesos),
    })) : [],
  };
}

function carregarControle() {
  const row = get('SELECT dados_json, atualizado_em FROM controle_densidade WHERE id = 1');
  if (!row) return { ...controlePadrao(), atualizadoEm: null };
  try {
    return { ...normalizarControle(JSON.parse(row.dados_json)), atualizadoEm: row.atualizado_em };
  } catch {
    return { ...controlePadrao(), atualizadoEm: row.atualizado_em };
  }
}

function servirArquivo(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) return erro(res, 403, 'FORBIDDEN', 'Acesso negado.');
  if (!fs.existsSync(filePath)) {
    const index = path.join(publicDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...securityHeaders() });
    return res.end(fs.readFileSync(index));
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
  res.writeHead(200, { 'Content-Type': `${types[ext] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600', ...securityHeaders() });
  res.end(fs.readFileSync(filePath));
}

async function api(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;
  const method = req.method;

  if (method === 'GET' && pathName === '/api/lock/users') {
    return erro(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (method === 'GET' && pathName === '/api/configuracoes/bloqueio') {
    const row = get('SELECT valor FROM configuracoes WHERE chave = ?', ['bloqueio_automatico_minutos']);
    return json(res, 200, { bloqueioAutomaticoMinutos: row?.valor || '15' });
  }

  if (method === 'POST' && pathName === '/api/lock/auth') {
    return erro(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  const usuario = exigir(req, res);
  if (!usuario) return;

  if (method === 'GET' && pathName === '/api/me') {
    return json(res, 200, { usuario });
  }

  if (pathName === '/api/controle-densidade') {
    if (method === 'GET') return json(res, 200, carregarControle());
    if (method === 'PUT') {
      const anterior = carregarControle();
      const dados = normalizarControle(await lerBody(req));
      run('UPDATE controle_densidade SET dados_json = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = 1', [JSON.stringify(dados)]);
      auditar(usuario, 'controle_densidade', 1, 'salvou', anterior, dados);
      return json(res, 200, carregarControle());
    }
  }

  if (method === 'GET' && pathName === '/api/controle-densidade/exportacao') {
    if (url.searchParams.get('formato') !== 'xlsx') {
      return erro(res, 400, 'INVALID_REQUEST', 'Informe formato=xlsx.');
    }
    const dados = carregarControle();
    const buffer = await gerarPlanilhaControleDensidade(dados);
    const lote = (dados.cabecalho.lote || 'sem-lote')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const nomeArquivo = `controle-densidade_${lote || 'sem-lote'}.xlsx`;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Cache-Control': 'no-store',
      ...securityHeaders(),
    });
    return res.end(buffer);
  }

  return erro(res, 404, 'NOT_FOUND', 'Modulo indisponivel nesta versao. Use o Controle de Densidade.');
}

migrate();

const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host) return erro(res, 403, 'INVALID_ORIGIN', 'Origem da requisição não permitida.');
    }
    if (req.url.startsWith('/api/')) return await api(req, res);
    return servirArquivo(req, res);
  } catch (err) {
    const status = err.status || (err.message === 'JSON inválido.' ? 400 : 500);
    return erro(res, status, err.code || (status >= 500 ? 'SERVER_ERROR' : 'INVALID_REQUEST'), status >= 500 ? 'Não foi possível concluir a operação.' : err.message);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Sistema de cartas de peso em http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
