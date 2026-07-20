'use strict';

// Compatibility entry point. New runs start conditional_shutdown_watcher.ps1
// directly. This file remains so older launch commands do not fail after an overlay.
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const map = new Map();
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith('--')) continue;
  const key = args[i].slice(2);
  const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
  map.set(key, value);
}
const pair = (name, psName) => map.has(name) ? [psName, map.get(name)] : [];
const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const script = path.join(__dirname, 'conditional_shutdown_watcher.ps1');
const psArgs = ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',script]
  .concat(pair('watch-pid','-WatchPid'))
  .concat(pair('completion','-Completion'))
  .concat(pair('out-xlsx','-OutXlsx'))
  .concat(pair('out-summary','-OutSummary'))
  .concat(pair('out-collision','-OutCollision'))
  .concat(pair('out-audit','-OutAudit'))
  .concat(pair('out-debug-rows','-OutDebugRows'))
  .concat(pair('out-checkpoint','-OutCheckpoint'))
  .concat(pair('out-progress','-OutProgress'))
  .concat(pair('status-file','-StatusFile'))
  .concat(pair('token','-Token'))
  .concat(pair('delay-seconds','-DelaySeconds'))
  .concat(pair('comment','-Comment'))
  .concat(pair('shutdown-before','-ShutdownBefore'));
const child = spawn(powershell, psArgs, { windowsHide: true, stdio: 'ignore', detached: false });
child.on('exit', (code) => process.exit(code || 0));
child.on('error', (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
