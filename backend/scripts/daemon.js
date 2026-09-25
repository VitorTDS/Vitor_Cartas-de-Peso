const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');
const outPath = path.join(backendRoot, 'logs', 'server-out.log');
const errPath = path.join(backendRoot, 'logs', 'server-err.log');

fs.mkdirSync(path.join(backendRoot, 'logs'), { recursive: true });

const cmd = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', `start "" /b "${process.execPath}" --no-warnings "${path.join(backendRoot, 'src', 'server.js')}" >> "${outPath}" 2>> "${errPath}"`]
  : ['-c', `"${process.execPath}" --no-warnings "${path.join(backendRoot, 'src', 'server.js')}" >> "${outPath}" 2>> "${errPath}" &`];

const child = spawn(cmd, args, {
  cwd: projectRoot,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

child.unref();
console.log(`Servidor iniciado em background (pid ${child.pid}).`);
