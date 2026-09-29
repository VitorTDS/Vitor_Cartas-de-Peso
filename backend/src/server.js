const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { migrate, all, get, run, auditar, db, CAMPOS_CONFIG_PRODUTO } = require('./db');
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
      rqNumero: '6308',
      rqRevisao: '03',
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
      rqNumero: texto(cabecalho, 'rqNumero', false),
      rqRevisao: texto(cabecalho, 'rqRevisao', false),
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
      densidadeProdutoGml: numero(cabecalho.densidadeProdutoGml, 0),
      pesoEmbPrimariaG: numero(cabecalho.pesoEmbPrimariaG, 0),
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

// --- Produtos e cartas de peso ----------------------------------------------

function configDoProduto(produto) {
  if (!produto.config_json) return null; // modelo da carta ainda não cadastrado
  const config = JSON.parse(produto.config_json);
  return Object.fromEntries(CAMPOS_CONFIG_PRODUTO.map((campo) => [campo, config[campo]]));
}

// O cabeçalho fixo vem sempre do produto; do cliente só se aceitam lote e pesagens.
function dadosComConfig(body, produto) {
  const cabecalho = { ...(body.cabecalho || {}), ...configDoProduto(produto) };
  return normalizarControle({ ...body, cabecalho });
}

function dadosCartaNova(produto) {
  return dadosComConfig({
    cabecalho: {
      lote: '',
      densidade1: 0,
      densidade2: 0,
      impressoPor: '',
      conferidoPor: '',
    },
    verificacoes: [],
  }, produto);
}

// Carta aberta sempre exibe o modelo atual do produto; carta salva é o retrato
// exato do que foi gravado na finalização.
function mapCarta(row) {
  const gravados = JSON.parse(row.dados_json);
  const produto = row.status === 'aberta' ? get('SELECT * FROM produtos_carta WHERE id = ?', [row.produto_id]) : null;
  const dados = produto?.config_json ? dadosComConfig(gravados, produto) : normalizarControle(gravados);
  return {
    id: row.id,
    produtoId: row.produto_id,
    status: row.status,
    lote: row.lote,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    finalizadaEm: row.finalizada_em,
    ...dados,
  };
}

// Mesma regra da ficha: volume = (peso - H8) / H7, com H7/H8 do modelo do produto.
function resumoCarta(dados) {
  const cab = dados.cabecalho;
  const medias = dados.verificacoes.map((v) => {
    const volumes = v.pesos.filter((p) => p > 0 && cab.densidadeProdutoGml > 0)
      .map((p) => (p - cab.pesoEmbPrimariaG) / cab.densidadeProdutoGml);
    return volumes.length ? volumes.reduce((s, x) => s + x, 0) / volumes.length : null;
  }).filter((m) => m !== null);
  return {
    verificacoesPreenchidas: medias.length,
    foraDaFaixa: medias.some((m) => m < cab.minimoMl || m > cab.maximoMl),
  };
}

function buscarProduto(id) {
  return get('SELECT * FROM produtos_carta WHERE id = ? AND ativo = 1', [id]);
}

function buscarCarta(id) {
  return get('SELECT * FROM cartas_peso WHERE id = ?', [id]);
}

function emTransacao(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function nomeArquivoCarta(carta) {
  const lote = String(carta.lote || 'sem-lote')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `carta-de-peso_${lote || 'sem-lote'}_${carta.id}.xlsx`;
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

  if (method === 'GET' && pathName === '/api/produtos') {
    const produtos = all(`
      SELECT p.*,
        (SELECT id FROM cartas_peso c WHERE c.produto_id = p.id AND c.status = 'aberta') AS carta_aberta_id,
        (SELECT COUNT(*) FROM cartas_peso c WHERE c.produto_id = p.id AND c.status = 'finalizada') AS total_salvas
      FROM produtos_carta p WHERE p.ativo = 1 ORDER BY p.nome
    `);
    return json(res, 200, {
      data: produtos.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        modeloPronto: Boolean(p.config_json),
        config: configDoProduto(p),
        cartaAbertaId: p.carta_aberta_id,
        totalSalvas: p.total_salvas,
      })),
    });
  }

  let rota = /^\/api\/produtos\/(\d+)\/carta-aberta$/.exec(pathName);
  if (rota && method === 'GET') {
    const produto = buscarProduto(Number(rota[1]));
    if (!produto) return erro(res, 404, 'NOT_FOUND', 'Produto não encontrado.');
    const carta = get("SELECT * FROM cartas_peso WHERE produto_id = ? AND status = 'aberta'", [produto.id]);
    if (!carta) return erro(res, 404, 'NOT_FOUND', 'Este produto não tem carta aberta.');
    return json(res, 200, mapCarta(carta));
  }

  rota = /^\/api\/produtos\/(\d+)\/cartas$/.exec(pathName);
  if (rota) {
    const produto = buscarProduto(Number(rota[1]));
    if (!produto) return erro(res, 404, 'NOT_FOUND', 'Produto não encontrado.');
    if (method === 'GET') {
      const status = url.searchParams.get('status') || 'finalizada';
      if (!['aberta', 'finalizada'].includes(status)) return erro(res, 400, 'INVALID_REQUEST', 'status deve ser aberta ou finalizada.');
      const cartas = all(
        'SELECT * FROM cartas_peso WHERE produto_id = ? AND status = ? ORDER BY COALESCE(finalizada_em, criado_em) DESC, id DESC',
        [produto.id, status],
      );
      return json(res, 200, {
        data: cartas.map((row) => {
          const carta = mapCarta(row);
          return { id: carta.id, lote: carta.lote, status: carta.status, criadoEm: carta.criadoEm, finalizadaEm: carta.finalizadaEm, ...resumoCarta(carta) };
        }),
      });
    }
    if (method === 'POST') {
      if (!produto.config_json) {
        return erro(res, 422, 'MODELO_PENDENTE', 'O modelo da carta de peso deste produto ainda não foi cadastrado.');
      }
      const aberta = get("SELECT id FROM cartas_peso WHERE produto_id = ? AND status = 'aberta'", [produto.id]);
      if (aberta) {
        return erro(res, 409, 'CARTA_ABERTA_EXISTENTE', 'Este produto já tem uma carta aberta.', [{ field: 'cartaAbertaId', message: String(aberta.id) }]);
      }
      const dados = dadosCartaNova(produto);
      const criada = run('INSERT INTO cartas_peso (produto_id, lote, status, dados_json) VALUES (?, ?, ?, ?)', [produto.id, '', 'aberta', JSON.stringify(dados)]);
      auditar(usuario, 'cartas_peso', criada.lastInsertRowid, 'criou', null, dados);
      return json(res, 201, mapCarta(buscarCarta(criada.lastInsertRowid)), { Location: `/api/cartas/${criada.lastInsertRowid}` });
    }
  }

  rota = /^\/api\/cartas\/(\d+)(?:\/(finalizacao|exportacao))?$/.exec(pathName);
  if (rota) {
    const carta = buscarCarta(Number(rota[1]));
    if (!carta) return erro(res, 404, 'NOT_FOUND', 'Carta não encontrada.');
    const acao = rota[2];

    if (!acao && method === 'GET') return json(res, 200, mapCarta(carta));

    if (!acao && method === 'PUT') {
      if (carta.status === 'finalizada') return erro(res, 409, 'CARTA_FINALIZADA', 'Esta carta já foi salva e não pode ser alterada.');
      const produto = get('SELECT * FROM produtos_carta WHERE id = ?', [carta.produto_id]);
      const dados = dadosComConfig(await lerBody(req), produto);
      run(
        "UPDATE cartas_peso SET dados_json = ?, lote = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND status = 'aberta'",
        [JSON.stringify(dados), dados.cabecalho.lote, carta.id],
      );
      auditar(usuario, 'cartas_peso', carta.id, 'salvou rascunho', JSON.parse(carta.dados_json), dados);
      return json(res, 200, mapCarta(buscarCarta(carta.id)));
    }

    if (acao === 'finalizacao' && method === 'POST') {
      if (carta.status === 'finalizada') return erro(res, 409, 'CARTA_FINALIZADA', 'Esta carta já foi salva.');
      const produto = get('SELECT * FROM produtos_carta WHERE id = ?', [carta.produto_id]);
      const body = await lerBody(req);
      // O cliente manda o estado atual junto, para não depender do autosave ter terminado.
      const dados = body.cabecalho ? dadosComConfig(body, produto) : mapCarta(carta);
      const { id: _id, produtoId: _p, status: _s, lote: _l, criadoEm: _c, atualizadoEm: _a, finalizadaEm: _f, ...somenteDados } = dados;
      if (!String(somenteDados.cabecalho.lote || '').trim()) {
        return erro(res, 422, 'LOTE_OBRIGATORIO', 'Informe o lote antes de salvar a carta.', [{ field: 'lote', message: 'obrigatório' }]);
      }
      emTransacao(() => {
        run(
          "UPDATE cartas_peso SET dados_json = ?, lote = ?, status = 'finalizada', finalizada_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND status = 'aberta'",
          [JSON.stringify(somenteDados), somenteDados.cabecalho.lote, carta.id],
        );
        auditar(usuario, 'cartas_peso', carta.id, 'finalizou', JSON.parse(carta.dados_json), somenteDados);
      });
      return json(res, 200, mapCarta(buscarCarta(carta.id)));
    }

    if (acao === 'exportacao' && method === 'GET') {
      if (url.searchParams.get('formato') !== 'xlsx') return erro(res, 400, 'INVALID_REQUEST', 'Informe formato=xlsx.');
      const dados = mapCarta(carta);
      const buffer = await gerarPlanilhaControleDensidade(dados);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nomeArquivoCarta(dados)}"`,
        'Cache-Control': 'no-store',
        ...securityHeaders(),
      });
      return res.end(buffer);
    }

    return erro(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido nesta rota.');
  }

  return erro(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
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
