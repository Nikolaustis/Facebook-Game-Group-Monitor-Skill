const fs = require('fs');
const path = require('path');

function cleanValue(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function atomicWriteText(file, content, encoding = 'utf8') {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, encoding);
  try {
    fs.renameSync(tmp, file);
  } catch (_err) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_e) { /* ignore */ }
    try {
      fs.renameSync(tmp, file);
    } catch (_err2) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
      fs.writeFileSync(file, content, encoding);
    }
  }
}

function writeJsonAtomic(file, obj) {
  if (!file) return;
  atomicWriteText(file, JSON.stringify(obj, null, 2), 'utf8');
}

function parseProgressReportEveryMinutes(args = {}, config = {}, defaultMinutes = 30) {
  const raw =
    args['progress-report-every-minutes'] ??
    args['codex-progress-report-every-minutes'] ??
    config.progress_report_every_minutes ??
    config.codex_progress_report_every_minutes ??
    process.env.CODEX_PROGRESS_REPORT_EVERY_MINUTES ??
    process.env.FB_MONITOR_PROGRESS_REPORT_EVERY_MINUTES ??
    defaultMinutes;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return defaultMinutes;
  if (minutes <= 0) return 0;
  return minutes;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m${String(secs).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function createProgressMessage(phase, progress, elapsedSec, trigger) {
  const elapsed = formatDuration(elapsedSec);
  if (phase === 'phase1') {
    const gamePart = progress.current_game_name
      ? `${progress.current_game_index || '?'} / ${progress.total_games || '?'} 个游戏：${progress.current_game_name}`
      : '等待开始';
    const queryPart = progress.current_query
      ? `当前查询「${progress.current_query}」(${progress.current_query_variant_type || 'variant'})，第 ${progress.current_round || 0} 轮`
      : '当前查询未开始';
    return `Codex 自动进度汇报：第一轮已运行 ${elapsed}，正在处理 ${gamePart}；${queryPart}；当前查询候选 ${progress.current_query_candidates || 0} 个，总候选约 ${progress.total_candidates || 0} 个。`;
  }

  if (phase === 'phase2') {
    const gamePart = progress.current_game_name
      ? `${progress.current_game_index || '?'} / ${progress.total_games || '?'} 个游戏：${progress.current_game_name}`
      : '等待开始';
    const candidatePart = progress.current_candidate_total
      ? `当前候选 ${progress.current_candidate_index || 0} / ${progress.current_candidate_total}`
      : '当前候选未开始';
    return `Codex 自动进度汇报：第二轮已运行 ${elapsed}，正在处理 ${gamePart}；${candidatePart}；累计处理 ${progress.total_processed_candidates || 0} 个候选，已暂存有效行 ${progress.staged_rows || 0} 行，最近状态 ${progress.last_candidate_status || trigger || 'unknown'}。`;
  }

  return `Codex 自动进度汇报：${phase || 'task'} 已运行 ${elapsed}。`;
}

function createCodexProgressReporter(options = {}) {
  const phase = cleanValue(options.phase) || 'task';
  const intervalMinutes = Number(options.intervalMinutes);
  const disabled = !Number.isFinite(intervalMinutes) || intervalMinutes <= 0;
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  if (disabled) {
    return {
      emit: () => null,
      writeSnapshot: () => null,
      stop: () => {},
    };
  }

  const startedAt = Date.now();
  const outFile = cleanValue(options.outFile);
  const getProgress = typeof options.getProgress === 'function' ? options.getProgress : () => ({});
  const log = typeof options.log === 'function' ? options.log : console.log;
  let timer = null;
  let stopped = false;

  const buildReport = (trigger) => {
    const now = new Date().toISOString();
    let progress = {};
    try {
      progress = getProgress() || {};
    } catch (err) {
      progress = { progress_error: err && err.message ? err.message : String(err) };
    }
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    const report = {
      event: 'codex_progress_report',
      phase,
      trigger,
      updated_at: now,
      elapsed_sec: elapsedSec,
      elapsed: formatDuration(elapsedSec),
      message: createProgressMessage(phase, progress, elapsedSec, trigger),
      progress,
    };
    if (outFile) writeJsonAtomic(outFile, report);
    return report;
  };

  const emit = (trigger = 'manual') => {
    if (stopped) return null;
    const report = buildReport(trigger);
    try {
      log(JSON.stringify(report));
    } catch (_err) {
      // Ignore logging failures; file output has already been attempted.
    }
    return report;
  };

  const writeSnapshot = (trigger = 'snapshot') => {
    if (stopped) return null;
    return buildReport(trigger);
  };

  timer = setInterval(() => emit('timer'), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  writeSnapshot('started');

  return {
    emit,
    writeSnapshot,
    stop(finalTrigger = 'stopped') {
      if (stopped) return;
      if (timer) clearInterval(timer);
      emit(finalTrigger);
      stopped = true;
    },
  };
}

module.exports = {
  createCodexProgressReporter,
  parseProgressReportEveryMinutes,
  formatDuration,
};
