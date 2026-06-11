const crypto = require('node:crypto');
const config = require('./config');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(senha), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verificarSenha(senha, senhaHash) {
  const [salt, hash] = String(senhaHash || '').split(':');
  if (!salt || !hash) return false;
  const tentativa = hashSenha(senha, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(tentativa));
}

function assinar(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }));
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verificarToken(token) {
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) return null;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { hashSenha, verificarSenha, assinar, verificarToken };
