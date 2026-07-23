const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { readJsonFile, writeJsonAtomic } = require('./json_io');

function parseSupervisorArgs(argv) {
  const split = argv.indexOf('--');
  const own = split >= 0 ? argv.slice(0, split) : argv;
  const child = split >= 0 ? argv.slice(split + 1) : [];
  const out = {};
  for (let i = 0; i < own.length; i++) {
    const item = own[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = own[i + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else { out[key] = next; i++; }
  }
  return { args: out, child };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_err) { return false; }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    } else process.kill(pid, 'SIGKILL');
  } catch (_err) {}
}

function readStatus(file) {
  try { return readJsonFile(file, { allowMissing: true, defaultValue: {} }) || {}; }
  catch (_err) { return {}; }
}

function updateStatus(file, fields) {
  const current = readStatus(file);
  writeJsonAtomic(file, { ...current, ...fields, updated_at: new Date().toISOString() });
}

function tailFile(file, maxBytes = 12000) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8').slice(-maxBytes);
  } catch (_err) { return ''; }
}


function openAppendStream(file, label, runnerStatus) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'a');
    const stream = fs.createWriteStream(file, { fd, autoClose: true, flags: 'a' });
    return { stream, error: null };
  } catch (err) {
    const message = `${label}_open_failed: ${err && err.message ? err.message : err}`;
    try {
      updateStatus(runnerStatus, {
        status: 'supervisor_log_open_failed',
        startup_verified: false,
        log_file: file,
        log_label: label,
        spawn_error: message,
        failed_at: new Date().toISOString(),
      });
    } catch (_err) {}
    throw new Error(message);
  }
}

function getProgressSignal(file, startedMs, previousMtimeMs) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (stat.mtimeMs <= Math.max(previousMtimeMs || 0, startedMs - 1000)) return null;
    const payload = readJsonFile(file);
    const updated = Date.parse(payload.updated_at || payload.finalized_at || payload.progress?.last_checkpoint_at || '');
    if (Number.isFinite(updated) && updated < startedMs - 2000) return null;
    const progress = payload.progress || payload;
    return {
      stage: progress.stage || progress.status || '',
      current_game_name: progress.current_game_name || '',
      current_game_index: progress.current_game_index || '',
      current_candidate_index: progress.current_candidate_index || 0,
      updated_at: payload.updated_at || progress.last_checkpoint_at || '',
    };
  } catch (_err) { return null; }
}

(async () => {
  const { args, child } = parseSupervisorArgs(process.argv.slice(2));
  if (child.length < 1) throw new Error('phase2_supervisor requires child script and arguments after --');
  const runnerStatus = path.resolve(args['runner-status'] || 'scheduled_phase2_runner_status.json');
  const progressFile = path.resolve(args['progress-file'] || 'phase2_progress.json');
  const stdoutLog = path.resolve(args['stdout-log'] || 'phase2.stdout.log');
  const stderrLog = path.resolve(args['stderr-log'] || 'phase2.stderr.log');
  const startupTimeoutMs = Math.max(15000, Number(args['startup-timeout-seconds'] || 90) * 1000);
  const childScript = path.resolve(child[0]);
  const childArgs = child.slice(1);
  const previousProgressMtime = fs.existsSync(progressFile) ? fs.statSync(progressFile).mtimeMs : 0;
  const startedMs = Date.now();
  if (path.resolve(stdoutLog).toLowerCase() === path.resolve(stderrLog).toLowerCase()) {
    throw new Error(`Supervisor child stdout and stderr logs must be different files: ${stdoutLog}`);
  }
  const outHandle = openAppendStream(stdoutLog, 'child_stdout_log', runnerStatus);
  const errHandle = openAppendStream(stderrLog, 'child_stderr_log', runnerStatus);
  const outStream = outHandle.stream;
  const errStream = errHandle.stream;
  let streamFailure = null;
  const onStreamError = (label) => (err) => {
    if (!streamFailure) {
      streamFailure = { label, reason: err && err.message ? err.message : String(err) };
      try {
        updateStatus(runnerStatus, {
          status: 'supervisor_log_stream_error',
          startup_verified: false,
          log_label: label,
          spawn_error: streamFailure.reason,
          failed_at: new Date().toISOString(),
        });
      } catch (_err) {}
    }
  };
  outStream.on('error', onStreamError('child_stdout_log'));
  errStream.on('error', onStreamError('child_stderr_log'));
  outStream.write(`[supervisor] child_starting_at=${new Date().toISOString()} script=${childScript}\n`);

  const childProcess = spawn(process.execPath, [childScript, ...childArgs], {
    cwd: process.cwd(),
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  childProcess.stdout.pipe(outStream, { end: false });
  childProcess.stderr.pipe(errStream, { end: false });
  updateStatus(runnerStatus, {
    status: 'phase2_launching',
    phase2_child_pid: childProcess.pid,
    phase2_child_alive: true,
    startup_verified: false,
    startup_timeout_seconds: startupTimeoutMs / 1000,
  });

  let exitInfo = null;
  childProcess.on('error', (err) => {
    exitInfo = { code: null, signal: '', spawn_error: err.message || String(err) };
  });
  childProcess.on('close', (code, signal) => {
    exitInfo = { code, signal: signal || '', spawn_error: '' };
  });

  let health = null;
  while (Date.now() - startedMs < startupTimeoutMs) {
    health = getProgressSignal(progressFile, startedMs, previousProgressMtime);
    if (health) break;
    if (streamFailure) { if (processAlive(childProcess.pid)) killTree(childProcess.pid); break; }
    if (exitInfo || !processAlive(childProcess.pid)) break;
    await sleep(1000);
  }

  if (!health) {
    if (!exitInfo && processAlive(childProcess.pid)) killTree(childProcess.pid);
    await sleep(300);
    const stderrTail = tailFile(stderrLog);
    updateStatus(runnerStatus, {
      status: streamFailure ? 'supervisor_log_stream_error' : (exitInfo ? 'phase2_startup_failed' : 'phase2_startup_timeout'),
      phase2_child_pid: childProcess.pid,
      phase2_child_alive: false,
      startup_verified: false,
      exit_code: exitInfo?.code ?? 1,
      signal: exitInfo?.signal || '',
      spawn_error: streamFailure?.reason || exitInfo?.spawn_error || '',
      stderr_tail: stderrTail.slice(-6000),
      startup_failed_at: new Date().toISOString(),
    });
    errStream.write(`[supervisor] startup_failed_at=${new Date().toISOString()} exit_code=${exitInfo?.code ?? ''}\n`);
    outStream.end();
    errStream.end();
    process.exit(exitInfo?.code && exitInfo.code !== 0 ? exitInfo.code : 3);
  }

  updateStatus(runnerStatus, {
    status: 'phase2_running',
    phase2_child_pid: childProcess.pid,
    phase2_child_alive: true,
    startup_verified: true,
    startup_verified_at: new Date().toISOString(),
    startup_progress: health,
  });
  outStream.write(`[supervisor] startup_verified_at=${new Date().toISOString()} stage=${health.stage || ''}\n`);

  while (!exitInfo) {
    if (streamFailure) {
      if (processAlive(childProcess.pid)) killTree(childProcess.pid);
      break;
    }
    await sleep(500);
  }
  if (streamFailure && !exitInfo) exitInfo = { code: 4, signal: '', spawn_error: streamFailure.reason };
  const success = exitInfo.code === 0;
  updateStatus(runnerStatus, {
    status: success ? 'finished_success' : 'finished_error',
    phase2_child_pid: childProcess.pid,
    phase2_child_alive: false,
    startup_verified: true,
    exit_code: exitInfo.code,
    signal: exitInfo.signal || '',
    spawn_error: streamFailure?.reason || exitInfo.spawn_error || '',
    finished_at: new Date().toISOString(),
    stderr_tail: success ? '' : tailFile(stderrLog).slice(-6000),
  });
  outStream.write(`[supervisor] child_finished_at=${new Date().toISOString()} exit_code=${exitInfo.code}\n`);
  outStream.end();
  errStream.end();
  process.exit(exitInfo.code || 0);
})().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
