const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { migrate, all, get, run, auditar, db, registrarAcesso } = require('./db');
const { verificarSenha, assinar, verificarToken, hashSenha } = require('./auth');

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
