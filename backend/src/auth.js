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
  const esperado = Buffer.from(hash, 'hex');
  const recebido = Buffer.from(tentativa, 'hex');
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

function assinar(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({ ...payload, iat, exp: iat + config.sessionMinutes * 60 }));
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verificarToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') return null;
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Number.isInteger(payload.id) || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashSenha, verificarSenha, assinar, verificarToken };
