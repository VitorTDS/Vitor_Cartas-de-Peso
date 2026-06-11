const crypto = require('node:crypto');

class BiometricService {
  constructor(mode = 'simulado') {
    this.mode = mode;
  }

  enroll(usuarioId) {
    return {
      provider: this.mode,
      templateId: crypto.randomUUID(),
      enrolledAt: new Date().toISOString(),
      usuarioId,
    };
  }

  verify({ templateId, simulatedResult }) {
    if (this.mode !== 'simulado') {
      throw new Error('Leitor biometrico real ainda nao configurado.');
    }
    return Boolean(templateId && simulatedResult === 'recognized');
  }
}

module.exports = new BiometricService(process.env.BIOMETRIC_MODE || 'simulado');
