const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile } = require('./env');

const projectRoot = path.resolve(__dirname, '..', '..');

loadEnvFile(path.join(projectRoot, '.env'));

function carregarJwtSecret() {
  const insecureDefault = 'dev-secret-cartas-de-peso-sobral-32chars';
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== insecureDefault) return process.env.JWT_SECRET;
  const secretPath = path.join(projectRoot, 'backend', 'data', '.jwt-secret');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
  }
  return fs.readFileSync(secretPath, 'utf8').trim();
}

const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  jwtSecret: carregarJwtSecret(),
  sessionMinutes: 50,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  maxBodyBytes: 512_000,
  databasePath: path.resolve(projectRoot, process.env.DATABASE_PATH || './backend/data/cartas-peso.sqlite'),
  nodeEnv: process.env.NODE_ENV || 'development',
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
}

module.exports = config;
