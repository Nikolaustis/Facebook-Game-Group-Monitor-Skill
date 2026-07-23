const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonAtomic } = require('./json_io');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function usableFile(file, minimumBytes = 2) {
  try {
    return fs.statSync(file).isFile() && fs.statSync(file).size >= minimumBytes;
  } catch (_err) {
    return false;
  }
}

function readState(file, label, errors) {
  try {
    return readJsonFile(file);
  } catch (err) {
    errors.push({
      label,
      file,
      code: err && err.code ? err.code : '',
      message: err && err.message ? err.message : String(err),
    });
    return null;
  }
}

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(clean(args['run-dir'] || ''));
  if (!runDir || !fs.existsSync(runDir)) {
    process.stderr.write('Usage: node verify_shutdown_state.js --run-dir <RunDir> [--out <file>]\n');
    process.exit(2);
  }

  const resolveInputFile = (argName, defaultName) => path.resolve(clean(args[argName] || path.join(runDir, defaultName)));
  const files = {
    completion: resolveInputFile('completion', 'codex_task_complete.json'),
    policy: resolveInputFile('policy', 'shutdown_policy.json'),
    checkpoint: resolveInputFile('checkpoint', 'phase2_autosave_state.json'),
    progress: resolveInputFile('progress', 'phase2_progress.json'),
    final_xlsx: resolveInputFile('final-xlsx', 'fb_monitoring_filtered.xlsx'),
    summary: resolveInputFile('summary', 'fb_monitoring_filtered_summary.json'),
    collision: resolveInputFile('collision', 'collision_report.json'),
    audit: resolveInputFile('audit', 'audit_stats.json'),
    debug_rows: resolveInputFile('debug-rows', 'debug_rows.json'),
  };
  const outFile = path.resolve(clean(args.out || path.join(runDir, 'shutdown_preflight_verification.json')));
  const coordinatorMode = clean(args['coordinator-mode'] || 'runner').toLowerCase() === 'watcher' ? 'watcher' : 'runner';
  const watcherToken = clean(args['watcher-token'] || '');
  const readErrors = [];
  const completion = readState(files.completion, 'completion', readErrors);
  const policy = readState(files.policy, 'policy', readErrors);
  const checkpoint = readState(files.checkpoint, 'checkpoint', readErrors);
  const progress = readState(files.progress, 'progress', readErrors);

  const mode = clean(policy && policy.mode ? policy.mode : completion && completion.shutdown_mode ? completion.shutdown_mode : 'none').toLowerCase();
  const enabled = mode === 'after_complete' || mode === 'before_deadline';
  const delayRaw = policy && policy.delay_seconds !== undefined
    ? policy.delay_seconds
    : completion && completion.shutdown_delay_seconds !== undefined
      ? completion.shutdown_delay_seconds
      : 60;
  const delaySeconds = Math.max(0, Number.isFinite(Number(delayRaw)) ? Math.trunc(Number(delayRaw)) : 60);
  const deadline = mode === 'before_deadline' && policy ? clean(policy.deadline) : '';
  const requestToken = completion ? clean(completion.shutdown_request_token) : '';
  const completedAt = completion ? clean(completion.completed_at || completion.updated_at) : '';

  const checks = {
    final_xlsx: usableFile(files.final_xlsx, 1024),
    summary_json: usableFile(files.summary, 2),
    collision_json: usableFile(files.collision, 2),
    audit_json: usableFile(files.audit, 2),
    debug_rows_json: usableFile(files.debug_rows, 2),
    checkpoint_readable: Boolean(checkpoint),
    progress_readable: Boolean(progress),
    completion_readable: Boolean(completion),
    policy_readable: Boolean(policy),
    checkpoint_finalized: Boolean(checkpoint && checkpoint.finalized === true),
    progress_finalized: Boolean(progress && progress.finalized === true),
    completion_verified: Boolean(completion && completion.phase2_finalization_verified === true),
    final_report_generated: Boolean(completion && completion.final_report_generated === true),
    report_created: Boolean(completion && completion.report_created === true),
    chrome_closed: Boolean(completion && completion.chrome_closed === true),
    shutdown_requested: Boolean(completion && completion.shutdown_requested === true),
    shutdown_request_token_present: Boolean(requestToken),
    coordinator_mode_runner: Boolean(completion && clean(completion.shutdown_coordinator_mode) === 'runner'),
    watcher_token_matches: Boolean(completion && watcherToken && clean(completion.shutdown_watcher_token) === watcherToken),
  };

  const requiredChecks = [
    'final_xlsx', 'summary_json', 'collision_json', 'audit_json', 'debug_rows_json',
    'checkpoint_readable', 'progress_readable', 'completion_readable',
    'checkpoint_finalized', 'progress_finalized', 'completion_verified',
    'final_report_generated', 'report_created', 'chrome_closed', 'shutdown_requested',
  ];
  if (coordinatorMode === 'runner') {
    requiredChecks.push('policy_readable', 'shutdown_request_token_present', 'coordinator_mode_runner');
  } else {
    requiredChecks.push('watcher_token_matches');
  }
  const allValid = requiredChecks.every((key) => checks[key] === true);

  const report = {
    verification_kind: 'facebook_group_monitor_shutdown_preflight',
    verification_version: 1,
    skill_version: '6.6.4',
    checked_at: new Date().toISOString(),
    run_dir: runDir,
    coordinator_mode: coordinatorMode,
    mode,
    enabled,
    delay_seconds: delaySeconds,
    deadline,
    request_token: requestToken,
    completed_at: completedAt,
    completion_status: completion ? clean(completion.status) : '',
    checks,
    required_checks: requiredChecks,
    all_valid: allValid,
    read_errors: readErrors,
    file_sizes: Object.fromEntries(Object.entries(files).map(([key, file]) => {
      try { return [key, fs.statSync(file).size]; } catch (_err) { return [key, 0]; }
    })),
  };
  writeJsonAtomic(outFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Shutdown verification written to: ${outFile}\n`);
  process.exitCode = readErrors.length ? 3 : 0;
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
