const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { migrate, all, get, run, auditar, db } = require('./db');
const { verificarSenha, assinar, verificarToken, hashSenha } = require('./auth');
const { calcularColeta, calcularResumoCarta } = require('./calculos');

const publicDir = path.resolve('public');

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function erro(res, status, code, message, details = []) {
  json(res, status, { error: { code, message, details } });
}

function lerBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error('Payload muito grande.'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
  });
}

function usuarioDaReq(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verificarToken(token);
  if (!payload) return null;
  return get('SELECT id,nome,email,perfil,status FROM usuarios WHERE id = ? AND status = ?', [payload.id, 'ativo']);
}

function exigir(req, res, perfis = []) {
  const usuario = usuarioDaReq(req);
  if (!usuario) {
    erro(res, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    return null;
  }
  if (perfis.length && !perfis.includes(usuario.perfil)) {
    erro(res, 403, 'FORBIDDEN', 'Seu perfil não tem permissão para esta ação.');
    return null;
  }
  return usuario;
}

function numeroObrigatorio(body, campo) {
  const valor = Number(body[campo]);
  if (!Number.isFinite(valor)) throw new Error(`Campo inválido: ${campo}`);
  return valor;
}

function texto(body, campo, obrigatorio = true) {
  const valor = String(body[campo] ?? '').trim();
  if (obrigatorio && !valor) throw new Error(`Campo obrigatório: ${campo}`);
  return valor;
}

function produtoPayload(body) {
  return {
    codigo: texto(body, 'codigo'),
    nome: texto(body, 'nome'),
    volumeDeclaradoMl: numeroObrigatorio(body, 'volumeDeclaradoMl'),
    densidadePadrao: numeroObrigatorio(body, 'densidadePadrao'),
    variacaoPercentual: numeroObrigatorio(body, 'variacaoPercentual'),
    volumeMinimoMl: numeroObrigatorio(body, 'volumeMinimoMl'),
    volumeMaximoMl: numeroObrigatorio(body, 'volumeMaximoMl'),
    pesoBrutoMinimoG: numeroObrigatorio(body, 'pesoBrutoMinimoG'),
    pesoBrutoMaximoG: numeroObrigatorio(body, 'pesoBrutoMaximoG'),
    tipoEmbalagem: texto(body, 'tipoEmbalagem'),
    quantidadeAmostras: Number(body.quantidadeAmostras || 10),
    status: body.status === 'inativo' ? 'inativo' : 'ativo',
  };
}

function mapProduto(row) {
  return row && {
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    volumeDeclaradoMl: row.volume_declarado_ml,
    densidadePadrao: row.densidade_padrao,
    variacaoPercentual: row.variacao_percentual,
    volumeMinimoMl: row.volume_minimo_ml,
    volumeMaximoMl: row.volume_maximo_ml,
    pesoBrutoMinimoG: row.peso_bruto_minimo_g,
    pesoBrutoMaximoG: row.peso_bruto_maximo_g,
    tipoEmbalagem: row.tipo_embalagem,
    quantidadeAmostras: row.quantidade_amostras,
    status: row.status,
  };
}

function mapCarta(row) {
  return row && {
    id: row.id,
    produtoId: row.produto_id,
    produtoNome: row.produto_nome,
    lote: row.lote,
    ordemProducao: row.ordem_producao,
    volumeDeclaradoMl: row.volume_declarado_ml,
    densidade: row.densidade,
    variacaoPercentual: row.variacao_percentual,
    volumeMinimoMl: row.volume_minimo_ml,
    volumeMaximoMl: row.volume_maximo_ml,
    pesoBrutoMinimoG: row.peso_bruto_minimo_g,
    pesoBrutoMaximoG: row.peso_bruto_maximo_g,
    maquinaBalancaId: row.maquina_balanca_id,
    maquinaEnvase: row.maquina_envase,
    linha: row.linha,
    balanca: row.balanca,
    dataAbertura: row.data_abertura,
    responsavelAbertura: row.responsavel_abertura,
    frequenciaMinutos: row.frequencia_minutos,
    toleranciaMinutos: row.tolerancia_minutos,
    quantidadeAmostras: row.quantidade_amostras,
    observacoes: row.observacoes,
    status: row.status,
    justificativa: row.justificativa,
    conferidoPor: row.conferido_por,
    assinaturaResponsavel: row.assinatura_responsavel,
    fechadaEm: row.fechada_em,
  };
}

function cartaCompleta(id) {
  return mapCarta(get(`
    SELECT c.*, p.nome AS produto_nome
    FROM cartas c
    JOIN produtos p ON p.id = c.produto_id
    WHERE c.id = ?
  `, [id]));
}

function coletasDaCarta(cartaId) {
  return all('SELECT * FROM coletas WHERE carta_id = ? ORDER BY numero_coleta', [cartaId]).map((row) => ({
    id: row.id,
    cartaId: row.carta_id,
    numeroColeta: row.numero_coleta,
    responsavel: row.responsavel,
    data: row.data,
    hora: row.hora,
    taraEmbalagemG: row.tara_embalagem_g,
    pesosBrutos: JSON.parse(row.pesos_brutos_json),
    resultado: JSON.parse(row.resultado_json),
    status: row.status,
  }));
}

function servirArquivo(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) return erro(res, 403, 'FORBIDDEN', 'Acesso negado.');
  if (!fs.existsSync(filePath)) {
    const index = path.join(publicDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(index));
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
  res.writeHead(200, { 'Content-Type': `${types[ext] || 'application/octet-stream'}; charset=utf-8` });
  res.end(fs.readFileSync(filePath));
}

async function api(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;
  const method = req.method;

  if (method === 'POST' && pathName === '/api/login') {
    const body = await lerBody(req);
    const usuario = get('SELECT * FROM usuarios WHERE email = ? AND status = ?', [texto(body, 'email'), 'ativo']);
    if (!usuario || !verificarSenha(body.senha, usuario.senha_hash)) {
      return erro(res, 401, 'INVALID_LOGIN', 'E-mail ou senha inválidos.');
    }
    return json(res, 200, {
      token: assinar({ id: usuario.id, perfil: usuario.perfil }),
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
    });
  }

  const usuario = exigir(req, res);
  if (!usuario) return;

  if (method === 'GET' && pathName === '/api/me') return json(res, 200, { usuario });

  if (pathName === '/api/produtos') {
    if (method === 'GET') return json(res, 200, { data: all('SELECT * FROM produtos ORDER BY nome').map(mapProduto) });
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    const body = await lerBody(req);
    const p = produtoPayload(body);
    const info = run(`
      INSERT INTO produtos
      (codigo,nome,volume_declarado_ml,densidade_padrao,variacao_percentual,volume_minimo_ml,volume_maximo_ml,peso_bruto_minimo_g,peso_bruto_maximo_g,tipo_embalagem,quantidade_amostras,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `, [p.codigo, p.nome, p.volumeDeclaradoMl, p.densidadePadrao, p.variacaoPercentual, p.volumeMinimoMl, p.volumeMaximoMl, p.pesoBrutoMinimoG, p.pesoBrutoMaximoG, p.tipoEmbalagem, p.quantidadeAmostras, p.status]);
    auditar(admin, 'produtos', info.lastInsertRowid, 'criou', null, p);
    return json(res, 201, mapProduto(get('SELECT * FROM produtos WHERE id = ?', [info.lastInsertRowid])));
  }

  const produtoMatch = pathName.match(/^\/api\/produtos\/(\d+)$/);
  if (produtoMatch && method === 'PUT') {
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    const id = Number(produtoMatch[1]);
    const anterior = mapProduto(get('SELECT * FROM produtos WHERE id = ?', [id]));
    if (!anterior) return erro(res, 404, 'NOT_FOUND', 'Produto não encontrado.');
    const p = produtoPayload(await lerBody(req));
    run(`
      UPDATE produtos SET codigo=?, nome=?, volume_declarado_ml=?, densidade_padrao=?, variacao_percentual=?, volume_minimo_ml=?,
      volume_maximo_ml=?, peso_bruto_minimo_g=?, peso_bruto_maximo_g=?, tipo_embalagem=?, quantidade_amostras=?, status=?, atualizado_em=CURRENT_TIMESTAMP
      WHERE id=?
    `, [p.codigo, p.nome, p.volumeDeclaradoMl, p.densidadePadrao, p.variacaoPercentual, p.volumeMinimoMl, p.volumeMaximoMl, p.pesoBrutoMinimoG, p.pesoBrutoMaximoG, p.tipoEmbalagem, p.quantidadeAmostras, p.status, id]);
    const novo = mapProduto(get('SELECT * FROM produtos WHERE id = ?', [id]));
    auditar(admin, 'produtos', id, 'alterou', anterior, novo);
    return json(res, 200, novo);
  }

  if (pathName === '/api/embalagens') {
    if (method === 'GET') return json(res, 200, { data: all('SELECT * FROM embalagens ORDER BY descricao') });
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    const body = await lerBody(req);
    const info = run('INSERT INTO embalagens (codigo,descricao,tipo,peso_medio_g,unidade,observacoes) VALUES (?,?,?,?,?,?)', [
      texto(body, 'codigo'), texto(body, 'descricao'), texto(body, 'tipo'), numeroObrigatorio(body, 'pesoMedioG'), body.unidade || 'g', body.observacoes || '',
    ]);
    auditar(admin, 'embalagens', info.lastInsertRowid, 'criou', null, body);
    return json(res, 201, get('SELECT * FROM embalagens WHERE id=?', [info.lastInsertRowid]));
  }

  if (pathName === '/api/maquinas-balancas') {
    if (method === 'GET') return json(res, 200, { data: all('SELECT * FROM maquinas_balancas ORDER BY linha, maquina_envase') });
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    const body = await lerBody(req);
    const info = run('INSERT INTO maquinas_balancas (linha,maquina_envase,tag_maquina,balanca,tag_balanca,status,observacoes) VALUES (?,?,?,?,?,?,?)', [
      texto(body, 'linha'), texto(body, 'maquinaEnvase'), texto(body, 'tagMaquina'), texto(body, 'balanca'), texto(body, 'tagBalanca'), body.status || 'ativo', body.observacoes || '',
    ]);
    auditar(admin, 'maquinas_balancas', info.lastInsertRowid, 'criou', null, body);
    return json(res, 201, get('SELECT * FROM maquinas_balancas WHERE id=?', [info.lastInsertRowid]));
  }

  if (pathName === '/api/usuarios') {
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    if (method === 'GET') return json(res, 200, { data: all('SELECT id,nome,email,perfil,status,criado_em FROM usuarios ORDER BY nome') });
    const body = await lerBody(req);
    const info = run('INSERT INTO usuarios (nome,email,perfil,senha_hash,status) VALUES (?,?,?,?,?)', [
      texto(body, 'nome'), texto(body, 'email'), texto(body, 'perfil'), hashSenha(texto(body, 'senha')), body.status || 'ativo',
    ]);
    auditar(admin, 'usuarios', info.lastInsertRowid, 'criou', null, { ...body, senha: '[protegida]' });
    return json(res, 201, get('SELECT id,nome,email,perfil,status,criado_em FROM usuarios WHERE id=?', [info.lastInsertRowid]));
  }

  if (pathName === '/api/cartas') {
    if (method === 'GET') {
      const where = [];
      const params = [];
      if (url.searchParams.get('produtoId')) { where.push('c.produto_id = ?'); params.push(url.searchParams.get('produtoId')); }
      if (url.searchParams.get('lote')) { where.push('c.lote LIKE ?'); params.push(`%${url.searchParams.get('lote')}%`); }
      if (url.searchParams.get('status')) { where.push('c.status = ?'); params.push(url.searchParams.get('status')); }
      const sql = `
        SELECT c.*, p.nome AS produto_nome FROM cartas c JOIN produtos p ON p.id = c.produto_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.data_abertura DESC, c.id DESC
      `;
      return json(res, 200, { data: all(sql, params).map(mapCarta) });
    }
    const operador = exigir(req, res, ['administrador', 'producao']);
    if (!operador) return;
    const body = await lerBody(req);
    const produto = mapProduto(get('SELECT * FROM produtos WHERE id = ?', [Number(body.produtoId)]));
    if (!produto) return erro(res, 404, 'NOT_FOUND', 'Produto não encontrado.');
    const maq = body.maquinaBalancaId ? get('SELECT * FROM maquinas_balancas WHERE id = ?', [Number(body.maquinaBalancaId)]) : null;
    const info = run(`
      INSERT INTO cartas
      (produto_id,lote,ordem_producao,volume_declarado_ml,densidade,variacao_percentual,volume_minimo_ml,volume_maximo_ml,peso_bruto_minimo_g,peso_bruto_maximo_g,
       maquina_balanca_id,maquina_envase,linha,balanca,data_abertura,responsavel_abertura,frequencia_minutos,tolerancia_minutos,quantidade_amostras,observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      produto.id, texto(body, 'lote'), body.ordemProducao || '', Number(body.volumeDeclaradoMl || produto.volumeDeclaradoMl),
      Number(body.densidade || produto.densidadePadrao), Number(body.variacaoPercentual || produto.variacaoPercentual),
      Number(body.volumeMinimoMl || produto.volumeMinimoMl), Number(body.volumeMaximoMl || produto.volumeMaximoMl),
      Number(body.pesoBrutoMinimoG || produto.pesoBrutoMinimoG), Number(body.pesoBrutoMaximoG || produto.pesoBrutoMaximoG),
      maq?.id || null, body.maquinaEnvase || maq?.maquina_envase || '', body.linha || maq?.linha || '', body.balanca || maq?.balanca || '',
      body.dataAbertura || new Date().toISOString(), body.responsavelAbertura || usuario.nome,
      Number(body.frequenciaMinutos || 30), Number(body.toleranciaMinutos || 10), Number(body.quantidadeAmostras || produto.quantidadeAmostras || 10), body.observacoes || '',
    ]);
    const carta = cartaCompleta(info.lastInsertRowid);
    auditar(usuario, 'cartas', carta.id, 'criou', null, carta);
    return json(res, 201, carta);
  }

  const cartaMatch = pathName.match(/^\/api\/cartas\/(\d+)$/);
  if (cartaMatch && method === 'GET') {
    const carta = cartaCompleta(Number(cartaMatch[1]));
    if (!carta) return erro(res, 404, 'NOT_FOUND', 'Carta não encontrada.');
    const coletas = coletasDaCarta(carta.id);
    return json(res, 200, { carta, coletas, resumo: calcularResumoCarta(carta, coletas) });
  }

  const coletasMatch = pathName.match(/^\/api\/cartas\/(\d+)\/coletas$/);
  if (coletasMatch) {
    const carta = cartaCompleta(Number(coletasMatch[1]));
    if (!carta) return erro(res, 404, 'NOT_FOUND', 'Carta não encontrada.');
    if (method === 'GET') return json(res, 200, { data: coletasDaCarta(carta.id) });
    const operador = exigir(req, res, ['administrador', 'producao']);
    if (!operador) return;
    if (carta.status !== 'aberta') return erro(res, 409, 'CARTA_FECHADA', 'Não é possível registrar coletas em carta fechada.');
    const body = await lerBody(req);
    const pesos = Array.from({ length: Number(carta.quantidadeAmostras || 10) }, (_, i) => Number(body.pesosBrutos?.[i] || 0)).filter(Boolean);
    const resultado = calcularColeta({
      taraEmbalagem: numeroObrigatorio(body, 'taraEmbalagemG'),
      pesosBrutos: pesos,
      densidade: carta.densidade,
      limites: {
        volumeMinimo: carta.volumeMinimoMl,
        volumeMaximo: carta.volumeMaximoMl,
        pesoBrutoMinimo: carta.pesoBrutoMinimoG,
        pesoBrutoMaximo: carta.pesoBrutoMaximoG,
      },
    });
    const info = run(`
      INSERT INTO coletas (carta_id,numero_coleta,responsavel,data,hora,tara_embalagem_g,pesos_brutos_json,resultado_json,status)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [
      carta.id, Number(body.numeroColeta), body.responsavel || usuario.nome, texto(body, 'data'), texto(body, 'hora'),
      Number(body.taraEmbalagemG), JSON.stringify(pesos), JSON.stringify(resultado), resultado.status,
    ]);
    const coleta = coletasDaCarta(carta.id).find((item) => item.id === Number(info.lastInsertRowid));
    auditar(usuario, 'coletas', info.lastInsertRowid, 'criou', null, coleta);
    return json(res, 201, coleta);
  }

  const fecharMatch = pathName.match(/^\/api\/cartas\/(\d+)\/fechamento$/);
  if (fecharMatch && method === 'POST') {
    const conferente = exigir(req, res, ['administrador', 'qualidade']);
    if (!conferente) return;
    const carta = cartaCompleta(Number(fecharMatch[1]));
    if (!carta) return erro(res, 404, 'NOT_FOUND', 'Carta não encontrada.');
    const anterior = { ...carta };
    const body = await lerBody(req);
    run('UPDATE cartas SET status=?, justificativa=?, conferido_por=?, assinatura_responsavel=?, fechada_em=? WHERE id=?', [
      body.statusFinal || calcularResumoCarta(carta, coletasDaCarta(carta.id)).statusFinalSugerido,
      body.justificativa || '',
      body.conferidoPor || conferente.nome,
      body.assinaturaResponsavel || body.conferidoPor || conferente.nome,
      new Date().toISOString(),
      carta.id,
    ]);
    const novo = cartaCompleta(carta.id);
    auditar(conferente, 'cartas', carta.id, 'fechou', anterior, novo);
    return json(res, 200, { carta: novo, resumo: calcularResumoCarta(novo, coletasDaCarta(carta.id)) });
  }

  if (pathName === '/api/auditoria' && method === 'GET') {
    exigir(req, res, ['administrador', 'qualidade']);
    return json(res, 200, { data: all('SELECT * FROM auditoria ORDER BY criado_em DESC LIMIT 300') });
  }

  const relatorioMatch = pathName.match(/^\/api\/cartas\/(\d+)\/relatorio$/);
  if (relatorioMatch && method === 'GET') {
    const carta = cartaCompleta(Number(relatorioMatch[1]));
    if (!carta) return erro(res, 404, 'NOT_FOUND', 'Carta não encontrada.');
    const coletas = coletasDaCarta(carta.id);
    return json(res, 200, { carta, coletas, resumo: calcularResumoCarta(carta, coletas), impressoEm: new Date().toISOString(), impressoPor: usuario.nome });
  }

  erro(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
}

migrate();

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await api(req, res);
    return servirArquivo(req, res);
  } catch (err) {
    return erro(res, err.message === 'JSON inválido.' ? 400 : 500, 'SERVER_ERROR', err.message);
  }
});

server.listen(config.port, () => {
  console.log(`Sistema de cartas de peso em http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
