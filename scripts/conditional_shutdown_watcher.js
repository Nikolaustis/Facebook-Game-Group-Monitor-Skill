'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function isTrue(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_err) {
    return null;
  }
}

function writeJsonAtomic(file, payload) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function hasUsableFile(file, minBytes = 2) {
  try {
    return Boolean(file && fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size >= minBytes);
  } catch (_err) {
    return false;
  }
}

function completionIsEligible(completion, token) {
  if (!completion || typeof completion !== 'object') return false;
  if (clean(completion.shutdown_watcher_token) !== clean(token)) return false;
  if (completion.final_report_generated !== true || completion.report_created !== true) return false;
  if (completion.phase2_finalization_verified !== true) return false;
  if (completion.close_chrome_after_report !== true || completion.chrome_closed !== true) return false;
  return [
    'completed_shutdown_watcher_started',
    'completed_shutdown_scheduled',
    'completed',
  ].includes(clean(completion.status));
}

function validateAllOutputs(files) {
  const checkpoint = readJson(files.outCheckpoint);
  const progress = readJson(files.outProgress);
  const checks = {
    final_xlsx: hasUsableFile(files.outXlsx, 1024),
    summary_json: hasUsableFile(files.outSummary),
    collision_json: hasUsableFile(files.outCollision),
    audit_json: hasUsableFile(files.outAudit),
    debug_rows_json: hasUsableFile(files.outDebugRows),
    checkpoint_finalized: Boolean(checkpoint && checkpoint.finalized === true),
    progress_finalized: Boolean(progress && progress.finalized === true),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function invokeForcedShutdown({ delaySeconds, comment }) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, requested: false, reason: `unsupported_platform:${process.platform}` });
      return;
    }
    const safeDelaySeconds = Math.max(0, Math.floor(Number(delaySeconds) || 0));
    const safeComment = clean(comment || 'FB group monitoring finished. System will shut down.').slice(0, 512);
    const args = ['/s', '/f', '/t', String(safeDelaySeconds), '/d', 'p:0:0', '/c', safeComment];
    execFile('shutdown.exe', args, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          requested: true,
          reason: err && err.message ? err.message : String(err),
          command: `shutdown.exe ${args.join(' ')}`,
          stdout: stdout || '',
          stderr: stderr || '',
        });
        return;
      }
      resolve({
        ok: true,
        requested: true,
        reason: 'forced_shutdown_command_sent',
        command: `shutdown.exe ${args.join(' ')}`,
        delay_seconds: safeDelaySeconds,
        force_apps: true,
        stdout: stdout || '',
        stderr: stderr || '',
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const watchPid = Number(args['watch-pid']);
  const completionFile = path.resolve(clean(args.completion));
  const files = {
    outXlsx: path.resolve(clean(args['out-xlsx'])),
    outSummary: path.resolve(clean(args['out-summary'])),
    outCollision: path.resolve(clean(args['out-collision'])),
    outAudit: path.resolve(clean(args['out-audit'])),
    outDebugRows: path.resolve(clean(args['out-debug-rows'])),
    outCheckpoint: path.resolve(clean(args['out-checkpoint'])),
    outProgress: path.resolve(clean(args['out-progress'])),
  };
  const statusFile = path.resolve(clean(args['status-file'] || path.join(path.dirname(completionFile), 'conditional_shutdown_watcher_status.json')));
  const token = clean(args.token);
  const delaySeconds = toNonNegativeInt(args['delay-seconds'], 60);
  const pollMs = Math.max(250, toNonNegativeInt(args['poll-ms'], 1000));
  const comment = clean(args.comment || 'FB group monitoring finished. System will shut down.');
  const dryRun = isTrue(args['dry-run']);

  if (!Number.isInteger(watchPid) || watchPid <= 0 || !completionFile || !files.outXlsx || !token) {
    throw new Error('Required arguments: --watch-pid, --completion, all output paths, and --token.');
  }

  const base = {
    watcher_kind: 'facebook_group_monitor_conditional_shutdown_watcher',
    watcher_version: 2,
    watcher_pid: process.pid,
    watch_pid: watchPid,
    completion_file: completionFile,
    ...files,
    token,
    delay_seconds: delaySeconds,
    force_apps: true,
    strict_finalization_gate: true,
    shutdown_command_template: `shutdown.exe /s /f /t ${delaySeconds} /d p:0:0 /c <comment>`,
    started_at: new Date().toISOString(),
  };

  writeJsonAtomic(statusFile, {
    ...base,
    status: 'watching_phase2_process',
    message: 'Waiting for phase 2 to exit; shutdown remains blocked until every final output and completion token is validated.',
    updated_at: new Date().toISOString(),
  });

  while (isPidAlive(watchPid)) await sleep(pollMs);

  const completion = readJson(completionFile);
  const outputs = validateAllOutputs(files);
  const completionReady = completionIsEligible(completion, token);
  if (!outputs.ok || !completionReady) {
    writeJsonAtomic(statusFile, {
      ...base,
      status: 'shutdown_not_requested_validation_failed',
      output_checks: outputs.checks,
      completion_ready: completionReady,
      completion_status: completion ? clean(completion.status) : '',
      message: 'Phase 2 exited, but strict finalization validation failed. Shutdown was not requested.',
      finished_at: new Date().toISOString(),
    });
    return;
  }

  if (dryRun) {
    writeJsonAtomic(statusFile, {
      ...base,
      status: 'dry_run_validated',
      output_checks: outputs.checks,
      completion_ready: true,
      message: 'Dry-run validation passed; shutdown was not requested.',
      finished_at: new Date().toISOString(),
    });
    return;
  }

  const shutdown = await invokeForcedShutdown({ delaySeconds, comment });
  writeJsonAtomic(statusFile, {
    ...base,
    status: shutdown.ok ? 'forced_shutdown_scheduled' : 'forced_shutdown_not_scheduled',
    output_checks: outputs.checks,
    completion_ready: true,
    shutdown,
    message: shutdown.ok
      ? 'Every final output was validated; forced shutdown was scheduled.'
      : 'Every final output was validated, but the shutdown command failed.',
    finished_at: new Date().toISOString(),
  });

  if (!shutdown.ok) process.exitCode = 1;
}

main().catch((err) => {
  const message = err && err.stack ? err.stack : String(err);
  console.error(`[conditional_shutdown_watcher] ${message}`);
  process.exitCode = 1;
});
