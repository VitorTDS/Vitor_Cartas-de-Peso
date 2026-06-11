const path = require('node:path');

const config = {
  port: Number(process.env.PORT || 8787),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-cartas-de-peso-sobral-32chars',
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/cartas-peso.sqlite'),
  nodeEnv: process.env.NODE_ENV || 'development',
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
}

module.exports = config;
