const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

class BiometricService {
  constructor(mode = 'simulado', options = {}) {
    this.mode = mode;
    this.provider = options.provider || mode;
    this.enrollCommand = options.enrollCommand || '';
    this.verifyCommand = options.verifyCommand || '';
  }

  isSimulated() {
    return this.mode === 'simulado';
  }

  realReady() {
    return Boolean(!this.isSimulated() && this.enrollCommand && this.verifyCommand);
  }

  enroll(usuarioId) {
    if (!this.isSimulated()) {
      const result = this.runBridge(this.enrollCommand, {
        BIOMETRIC_ACTION: 'enroll',
        BIOMETRIC_USER_ID: String(usuarioId),
      });
      const templateId = result.templateId || result.template_id || result.id;
      if (!templateId) throw new Error('Cadastro biometrico nao retornou templateId.');
      return {
        provider: result.provider || this.provider,
        templateId: String(templateId),
        enrolledAt: result.enrolledAt || new Date().toISOString(),
        usuarioId,
      };
    }

    return {
      provider: this.provider,
      templateId: crypto.randomUUID(),
      enrolledAt: new Date().toISOString(),
      usuarioId,
    };
  }

  verify({ templateId, simulatedResult }) {
    if (!templateId) return false;
    if (!this.isSimulated()) {
      const result = this.runBridge(this.verifyCommand, {
        BIOMETRIC_ACTION: 'verify',
        BIOMETRIC_TEMPLATE_ID: String(templateId),
      });
      return Boolean(result.ok ?? result.verified ?? result.recognized);
    }
    return simulatedResult === 'recognized';
  }

  status() {
    const detected = this.detectWindowsDevice();
    const realReady = this.realReady();
    return {
      mode: this.mode,
      provider: this.provider,
      simulated: this.isSimulated(),
      hardwareDetected: Boolean(detected),
      device: detected,
      realIntegrationReady: realReady,
      enrollConfigured: Boolean(this.enrollCommand),
      verifyConfigured: Boolean(this.verifyCommand),
      message: detected
        ? (realReady ? 'Leitor detectado e ponte biometrica configurada.' : 'Leitor detectado. Configure os comandos do SDK para captura real.')
        : 'Nenhum leitor biometrico compativel detectado automaticamente.',
    };
  }

  runBridge(command, extraEnv) {
    if (!command) throw new Error('Comando da ponte biometrica nao configurado.');

    const executable = command.trim().replace(/^"(.*)"$/, '$1');
    const out = execFileSync(executable, [], {
      encoding: 'utf8',
      timeout: Number(process.env.BIOMETRIC_TIMEOUT_MS || 30000),
      env: { ...process.env, ...extraEnv },
    }).trim();

    if (!out) return {};
    try {
      return JSON.parse(out);
    } catch {
      return {
        ok: /^(ok|true|recognized|verified|1)$/i.test(out),
        templateId: out,
      };
    }
  }

  detectWindowsDevice() {
    if (process.platform !== 'win32') return null;
    try {
      const script = [
        "$device = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\\\VID_3036&PID_0002*' } | Select-Object -First 1;",
        "if (-not $device) { exit 0 }",
        "$child = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\\\VID_3036&PID_0002&MI_00*' } | Select-Object -First 1;",
        "$props = if ($child) { Get-PnpDeviceProperty -InstanceId $child.InstanceId } else { @() };",
        "$friendly = if ($child) { $child.FriendlyName } else { $device.FriendlyName };",
        "$bus = ($props | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_BusReportedDeviceDesc' } | Select-Object -First 1).Data;",
        "[pscustomobject]@{ name = 'iDBio Pro'; friendlyName = $friendly; port = (($friendly -replace '^.*\\\\((COM[0-9]+)\\\\).*$', '$1')); vid = '3036'; pid = '0002'; busDescription = $bus; instanceId = $device.InstanceId } | ConvertTo-Json -Compress",
      ].join(' ');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) return this.detectWindowsDeviceWithPnpUtil();
      const parsed = JSON.parse(out);
      if (!/^COM\d+$/i.test(parsed.port || '')) parsed.port = '';
      return parsed;
    } catch {
      return this.detectWindowsDeviceWithPnpUtil();
    }
  }

  detectWindowsDeviceWithPnpUtil() {
    try {
      const out = execFileSync('pnputil.exe', ['/enum-devices', '/connected'], {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (!out.includes('VID_3036&PID_0002')) return null;
      const port = out.match(/Dispositivo Serial USB \((COM\d+)\)/i)?.[1] || '';
      const instanceId = out.match(/USB\\VID_3036&PID_0002[^\r\n]*/i)?.[0] || 'USB\\VID_3036&PID_0002';
      return {
        name: 'iDBio Pro',
        friendlyName: port ? `Dispositivo Serial USB (${port})` : 'USB Composite Device',
        port,
        vid: '3036',
        pid: '0002',
        busDescription: '',
        instanceId,
      };
    } catch {
      return null;
    }
  }
}

module.exports = new BiometricService(process.env.BIOMETRIC_MODE || 'simulado', {
  provider: process.env.BIOMETRIC_PROVIDER || process.env.BIOMETRIC_MODE || 'simulado',
  enrollCommand: process.env.BIOMETRIC_ENROLL_COMMAND || '',
  verifyCommand: process.env.BIOMETRIC_VERIFY_COMMAND || '',
});
