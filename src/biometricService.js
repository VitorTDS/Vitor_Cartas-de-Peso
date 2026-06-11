const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

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

  status() {
    const detected = this.detectWindowsDevice();
    return {
      mode: this.mode,
      simulated: this.mode === 'simulado',
      hardwareDetected: Boolean(detected),
      device: detected,
      realIntegrationReady: false,
      message: detected
        ? 'Leitor detectado. Integração real depende do SDK/protocolo do fabricante.'
        : 'Nenhum leitor biométrico compatível detectado automaticamente.',
    };
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
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 4000 }).trim();
      if (!out) return null;
      const parsed = JSON.parse(out);
      if (!/^COM\d+$/i.test(parsed.port || '')) parsed.port = '';
      return parsed;
    } catch {
      return null;
    }
  }
}

module.exports = new BiometricService(process.env.BIOMETRIC_MODE || 'simulado');
