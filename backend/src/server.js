const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { migrate, all, get, run, auditar, db, registrarAcesso, registrarAssinatura } = require('./db');
const { verificarSenha, assinar, verificarToken, hashSenha } = require('./auth');
const { calcularColeta, calcularResumoCarta } = require('./calculos');

const publicDir = path.resolve(__dirname, '..', '..', 'frontend');
const COOKIE_NAME = 'sobral_session';
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const dummyPasswordHash = hashSenha('senha-invalida-para-comparacao');

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

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((item) => {
    const index = item.indexOf('=');
    if (index < 0) return ['', ''];
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function tokenDaReq(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : cookies(req)[COOKIE_NAME];
}

function cookieSessao(token, maxAge = config.sessionMinutes * 60) {
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token || '')}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function emitirSessao(row) {
  const token = assinar({ id: row.id, perfil: row.perfil, sv: Number(row.sessao_versao || 1) });
  const payload = verificarToken(token);
  return { token, expiresAt: payload.exp * 1000 };
}

function loginKey(req, identificador) {
  return `${req.socket.remoteAddress || 'local'}:${String(identificador || '').trim().toLowerCase()}`;
}

function bloqueioLogin(req, identificador) {
  const key = loginKey(req, identificador);
  const entry = loginAttempts.get(key);
  if (!entry) return null;
  if (entry.blockedUntil > Date.now()) return Math.ceil((entry.blockedUntil - Date.now()) / 1000);
  if (Date.now() - entry.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  return null;
}

function registrarFalhaLogin(req, identificador) {
  const key = loginKey(req, identificador);
  const now = Date.now();
  const current = loginAttempts.get(key);
  const entry = !current || now - current.firstAttempt > LOGIN_WINDOW_MS
    ? { count: 0, firstAttempt: now, blockedUntil: 0 }
    : current;
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.blockedUntil = now + LOGIN_BLOCK_MS;
  loginAttempts.set(key, entry);
}

function limparFalhasLogin(req, identificador) {
  loginAttempts.delete(loginKey(req, identificador));
}

function validarNovaSenha(senha) {
  const value = String(senha || '');
  if (value.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  if (groups < 3) return 'Use pelo menos três grupos: maiúsculas, minúsculas, números e símbolos.';
  return '';
}

function usuarioDaReq(req) {
  const payload = verificarToken(tokenDaReq(req));
  if (!payload) return null;
  const row = get('SELECT * FROM usuarios WHERE id = ? AND status = ?', [payload.id, 'ativo']);
  if (!row || Number(payload.sv || 1) !== Number(row.sessao_versao || 1)) return null;
  const usuario = mapUsuario(row);
  usuario.sessaoExpiraEm = payload.exp * 1000;
  return usuario;
}

function exigir(req, res, perfis = []) {
  const usuario = usuarioDaReq(req);
  if (!usuario) {
    erro(res, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    return null;
  }
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

function dispositivo(req) {
  return req.headers['x-device-name'] || req.headers.host || 'computador-industrial';
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
      densidadeDeclarada: 1.0126,
      pesoEmbalagemPrimariaG: 26.07,
      minimoMl: 200,
      maximoMl: 202,
      maquinaTag: 'ECH-501013',
      linha: '',
      tagBalanca: 'BAL-501004',
      frequenciaMinutos: 30,
      toleranciaMinutos: 10,
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
  const volumeDeclaradoMl = numero(cabecalho.volumeDeclaradoMl, atual.cabecalho.volumeDeclaradoMl);
  const variacaoPermitidaPercentual = numero(cabecalho.variacaoPermitidaPercentual, atual.cabecalho.variacaoPermitidaPercentual);
  return {
    cabecalho: {
      produto: texto(cabecalho, 'produto', false) || atual.cabecalho.produto,
      lote: texto(cabecalho, 'lote', false),
      volumeDeclaradoMl,
      variacaoPermitidaPercentual,
      densidadeDeclarada: numero(cabecalho.densidadeDeclarada, atual.cabecalho.densidadeDeclarada),
      pesoEmbalagemPrimariaG: numero(cabecalho.pesoEmbalagemPrimariaG, atual.cabecalho.pesoEmbalagemPrimariaG),
      minimoMl: volumeDeclaradoMl,
      maximoMl: volumeDeclaradoMl * (1 + variacaoPermitidaPercentual / 100),
      maquinaTag: texto(cabecalho, 'maquinaTag', false),
      linha: texto(cabecalho, 'linha', false),
      tagBalanca: texto(cabecalho, 'tagBalanca', false),
      frequenciaMinutos: numero(cabecalho.frequenciaMinutos, atual.cabecalho.frequenciaMinutos),
      toleranciaMinutos: numero(cabecalho.toleranciaMinutos, atual.cabecalho.toleranciaMinutos),
    },
    verificacoes: Array.isArray(body.verificacoes) ? body.verificacoes.map((item) => ({
      id: texto(item, 'id', false) || String(Date.now()),
      realizadoPor: texto(item, 'realizadoPor', false),
      data: texto(item, 'data', false),
      hora: texto(item, 'hora', false),
      pesos: Array.from({ length: 10 }, (_, index) => numero(item.pesos?.[index], 0)),
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

function usuarioPayload(body, existente = {}) {
  return {
    nome: texto(body, 'nome'),
    nomeExibicao: texto(body, 'nomeExibicao', false) || texto(body, 'nome'),
    matricula: texto(body, 'matricula', false),
    setor: texto(body, 'setor', false),
    cargo: texto(body, 'cargo', false),
    email: texto(body, 'email'),
    perfil: texto(body, 'perfil'),
    status: body.status === 'inativo' ? 'inativo' : 'ativo',
    avatarUrl: texto(body, 'avatarUrl', false),
    senha: texto(body, 'senha', !existente.id),
  };
}

function validarAssinatura(usuario, body) {
  const row = get('SELECT * FROM usuarios WHERE id = ? AND status = ?', [usuario.id, 'ativo']);
  if (!row) return { ok: false, metodo: 'senha', mensagem: 'Usuario nao encontrado.' };
  const ok = verificarSenha(body.pin || body.senha || body.assinaturaResponsavel || '', row.senha_hash);
  return { ok, metodo: 'senha', mensagem: ok ? 'Senha validada.' : 'Senha invalida.' };
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

  if (method === 'POST' && pathName === '/api/login') {
    const body = await lerBody(req);
    const email = texto(body, 'email').toLowerCase();
    const retryAfter = bloqueioLogin(req, email);
    if (retryAfter) return erro(res, 429, 'LOGIN_BLOCKED', `Muitas tentativas. Aguarde ${Math.ceil(retryAfter / 60)} minuto(s).`, [], { 'Retry-After': retryAfter });
    const usuario = get('SELECT * FROM usuarios WHERE lower(email) = ? AND status = ?', [email, 'ativo']);
    const senhaCorreta = verificarSenha(body.senha, usuario?.senha_hash || dummyPasswordHash);
    if (!usuario || !senhaCorreta) {
      registrarFalhaLogin(req, email);
      registrarAcesso(usuario ? mapUsuario(usuario) : null, 'senha', 'falha', dispositivo(req), 'Login por e-mail falhou.');
      const bloqueadoAgora = bloqueioLogin(req, email);
      if (bloqueadoAgora) return json(res, 429, { error: { code: 'LOGIN_BLOCKED', message: 'Muitas tentativas. Aguarde 15 minutos.', details: [] } }, { 'Retry-After': bloqueadoAgora });
      return erro(res, 401, 'INVALID_LOGIN', 'E-mail ou senha inválidos.');
    }
    limparFalhasLogin(req, email);
    const mapped = mapUsuario(usuario);
    registrarAcesso(mapped, 'senha', 'sucesso', dispositivo(req), 'Login por e-mail.');
    const sessao = emitirSessao(usuario);
    return json(res, 200, {
      usuario: mapped,
      sessaoExpiraEm: sessao.expiresAt,
    }, { 'Set-Cookie': cookieSessao(sessao.token) });
  }

  if (method === 'POST' && pathName === '/api/logout') {
    return json(res, 200, { status: 'encerrada' }, { 'Set-Cookie': cookieSessao('', 0) });
  }

  const usuario = exigir(req, res);
  if (!usuario) return;

  if (method === 'GET' && pathName === '/api/me') {
    return json(res, 200, { usuario, sessaoExpiraEm: usuario.sessaoExpiraEm });
  }

  if (method === 'POST' && pathName === '/api/change-password') {
    const body = await lerBody(req);
    const row = get('SELECT * FROM usuarios WHERE id = ? AND status = ?', [usuario.id, 'ativo']);
    if (!row || !verificarSenha(body.senhaAtual, row.senha_hash)) {
      return erro(res, 401, 'INVALID_PASSWORD', 'A senha atual está incorreta.');
    }
    const passwordError = validarNovaSenha(body.novaSenha);
    if (passwordError) return erro(res, 422, 'WEAK_PASSWORD', passwordError);
    if (verificarSenha(body.novaSenha, row.senha_hash)) {
      return erro(res, 422, 'PASSWORD_REUSE', 'A nova senha deve ser diferente da senha atual.');
    }
    run('UPDATE usuarios SET senha_hash=?, deve_trocar_senha=0, sessao_versao=sessao_versao+1 WHERE id=?', [hashSenha(body.novaSenha), usuario.id]);
    const updated = get('SELECT * FROM usuarios WHERE id = ?', [usuario.id]);
    const mapped = mapUsuario(updated);
    const sessao = emitirSessao(updated);
    auditar(mapped, 'usuarios', usuario.id, 'alterou_senha', null, { senha: '[protegida]' });
    return json(res, 200, { usuario: mapped, sessaoExpiraEm: sessao.expiresAt }, { 'Set-Cookie': cookieSessao(sessao.token) });
  }

  if (usuario.deveTrocarSenha) {
    return erro(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'Troque sua senha inicial para continuar.');
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

  if (pathName === '/api/usuarios') {
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    if (method === 'GET') {
      return json(res, 200, { data: all('SELECT * FROM usuarios ORDER BY nome_exibicao, nome').map(mapUsuario) });
    }
    if (method === 'POST') {
      const body = await lerBody(req);
      const u = usuarioPayload(body);
      const passwordError = validarNovaSenha(u.senha);
      if (passwordError) return erro(res, 422, 'WEAK_PASSWORD', passwordError);
      const info = run(`
        INSERT INTO usuarios (nome,nome_exibicao,matricula,setor,cargo,email,perfil,senha_hash,status,avatar_url,deve_trocar_senha)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)
      `, [
        u.nome, u.nomeExibicao, u.matricula, u.setor, u.cargo, u.email, u.perfil, hashSenha(u.senha), u.status, u.avatarUrl,
      ]);
      const novo = mapUsuario(get('SELECT * FROM usuarios WHERE id=?', [info.lastInsertRowid]));
      auditar(admin, 'usuarios', info.lastInsertRowid, 'criou', null, { ...novo, senha: '[protegida]' });
      return json(res, 201, novo);
    }
  }

  return erro(res, 404, 'NOT_FOUND', 'Modulo indisponivel nesta versao. Use o Controle de Densidade.');

  if (pathName === '/api/configuracoes/bloqueio') {
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    const body = await lerBody(req);
    const permitido = ['5', '10', '15', '30', 'nunca'];
    const valor = permitido.includes(String(body.bloqueioAutomaticoMinutos)) ? String(body.bloqueioAutomaticoMinutos) : '15';
    run('INSERT OR REPLACE INTO configuracoes (chave,valor,atualizado_em) VALUES (?,?,CURRENT_TIMESTAMP)', ['bloqueio_automatico_minutos', valor]);
    auditar(admin, 'configuracoes', 'bloqueio_automatico_minutos', 'alterou', null, { valor });
    return json(res, 200, { bloqueioAutomaticoMinutos: valor });
  }

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
    if (method === 'GET') return json(res, 200, { data: all('SELECT * FROM usuarios ORDER BY nome_exibicao, nome').map(mapUsuario) });
    const body = await lerBody(req);
    const u = usuarioPayload(body);
    const info = run(`
      INSERT INTO usuarios (nome,nome_exibicao,matricula,setor,cargo,email,perfil,senha_hash,status,avatar_url)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [
      u.nome, u.nomeExibicao, u.matricula, u.setor, u.cargo, u.email, u.perfil, hashSenha(u.senha), u.status, u.avatarUrl,
    ]);
    const novo = mapUsuario(get('SELECT * FROM usuarios WHERE id=?', [info.lastInsertRowid]));
    auditar(admin, 'usuarios', info.lastInsertRowid, 'criou', null, { ...novo, senha: '[protegida]' });
    return json(res, 201, novo);
  }

  const usuarioMatch = pathName.match(/^\/api\/usuarios\/(\d+)$/);
  if (usuarioMatch && method === 'PUT') {
    const admin = exigir(req, res, ['administrador']);
    if (!admin) return;
    const id = Number(usuarioMatch[1]);
    const anteriorRow = get('SELECT * FROM usuarios WHERE id = ?', [id]);
    const anterior = mapUsuario(anteriorRow);
    if (!anteriorRow) return erro(res, 404, 'NOT_FOUND', 'Usuário não encontrado.');
    const body = await lerBody(req);
    const u = usuarioPayload(body, anterior);
    const senhaHash = u.senha ? hashSenha(u.senha) : anteriorRow.senha_hash;
    run(`
      UPDATE usuarios SET nome=?, nome_exibicao=?, matricula=?, setor=?, cargo=?, email=?, perfil=?, senha_hash=?, status=?, avatar_url=?
      WHERE id=?
    `, [u.nome, u.nomeExibicao, u.matricula, u.setor, u.cargo, u.email, u.perfil, senhaHash, u.status, u.avatarUrl, id]);
    const novo = mapUsuario(get('SELECT * FROM usuarios WHERE id=?', [id]));
    auditar(admin, 'usuarios', id, 'alterou', anterior, { ...novo, senha: '[protegida]' });
    return json(res, 200, novo);
  }

  if (pathName === '/api/logs-acesso' && method === 'GET') {
    exigir(req, res, ['administrador', 'qualidade', 'consulta_auditoria']);
    return json(res, 200, { data: all('SELECT * FROM logs_acesso ORDER BY criado_em DESC LIMIT 500') });
  }

  if (pathName === '/api/assinaturas-eletronicas' && method === 'GET') {
    exigir(req, res, ['administrador', 'qualidade', 'consulta_auditoria']);
    return json(res, 200, { data: all('SELECT * FROM assinaturas_eletronicas ORDER BY criado_em DESC LIMIT 500') });
  }

  if (pathName === '/api/assinaturas-eletronicas' && method === 'POST') {
    const body = await lerBody(req);
    const assinatura = validarAssinatura(usuario, body);
    if (!assinatura.ok) return erro(res, 401, 'SIGNATURE_FAILED', assinatura.mensagem);
    registrarAssinatura(usuario, texto(body, 'acao'), body.entidade || '', body.entidadeId || '', assinatura.metodo, body.observacao || '');
    return json(res, 201, { status: 'assinada', metodo: assinatura.metodo, usuario: mapUsuario(get('SELECT * FROM usuarios WHERE id=?', [usuario.id])) });
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
      body.dataAbertura || new Date().toISOString(), body.responsavelAbertura || operador.nome,
      Number(body.frequenciaMinutos || 30), Number(body.toleranciaMinutos || 10), Number(body.quantidadeAmostras || produto.quantidadeAmostras || 10), body.observacoes || '',
    ]);
    const carta = cartaCompleta(info.lastInsertRowid);
    auditar(operador, 'cartas', carta.id, 'criou', null, carta);
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
      carta.id, Number(body.numeroColeta), body.responsavel || operador.nome, texto(body, 'data'), texto(body, 'hora'),
      Number(body.taraEmbalagemG), JSON.stringify(pesos), JSON.stringify(resultado), resultado.status,
    ]);
    const coleta = coletasDaCarta(carta.id).find((item) => item.id === Number(info.lastInsertRowid));
    auditar(operador, 'coletas', info.lastInsertRowid, 'criou', null, coleta);
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
    const assinatura = validarAssinatura(conferente, body);
    if (!assinatura.ok) return erro(res, 401, 'SIGNATURE_FAILED', assinatura.mensagem);
    if (!body.justificativa && body.statusFinal && body.statusFinal !== 'aprovado') {
      return erro(res, 422, 'JUSTIFICATIVA_REQUIRED', 'Informe uma justificativa para fechamento com ressalva ou reprovação.');
    }
    run('UPDATE cartas SET status=?, justificativa=?, conferido_por=?, assinatura_responsavel=?, fechada_em=? WHERE id=?', [
      body.statusFinal || calcularResumoCarta(carta, coletasDaCarta(carta.id)).statusFinalSugerido,
      body.justificativa || '',
      body.conferidoPor || conferente.nome,
      `${conferente.nome} (${assinatura.metodo})`,
      new Date().toISOString(),
      carta.id,
    ]);
    const novo = cartaCompleta(carta.id);
    registrarAssinatura(conferente, 'fechamento_carta', 'cartas', carta.id, assinatura.metodo, body.justificativa || '');
    auditar(conferente, 'cartas', carta.id, 'fechou', anterior, novo);
    return json(res, 200, { carta: novo, resumo: calcularResumoCarta(novo, coletasDaCarta(carta.id)) });
  }

  if (pathName === '/api/auditoria' && method === 'GET') {
    const auditor = exigir(req, res, ['administrador', 'qualidade', 'consulta_auditoria']);
    if (!auditor) return;
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
