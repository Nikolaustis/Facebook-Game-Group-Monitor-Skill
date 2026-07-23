const fs = require('fs');
const path = require('path');
const { readJsonFile, readTextAuto, writeJsonAtomic } = require('./json_io');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else { out[key] = next; i++; }
  }
  return out;
}

function fileInfo(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  const decoded = readTextAuto(resolved);
  return {
    path: resolved,
    size_bytes: stat.size,
    detected_encoding: decoded.encoding,
  };
}

function resolveChildFile(value, parentFile) {
  const text = String(value || '').trim();
  if (!text) return '';
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(path.dirname(parentFile), text);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

(function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexFile = path.resolve(args.index || '');
  const configFile = args.config ? path.resolve(args.config) : '';
  const shutdownPolicyFile = args['shutdown-policy-file'] ? path.resolve(args['shutdown-policy-file']) : '';
  const outReport = path.resolve(args['out-report'] || path.join(path.dirname(indexFile || process.cwd()), 'phase2_input_validation.json'));
  const report = {
    validation_kind: 'facebook_group_monitor_phase2_inputs',
    version: '6.6.4',
    checked_at: new Date().toISOString(),
    ok: false,
    files: {},
    games: [],
    warnings: [],
    errors: [],
  };

  try {
    if (!indexFile || !fs.existsSync(indexFile)) throw new Error(`Index file does not exist: ${indexFile}`);
    report.files.index = fileInfo(indexFile);
    const index = readJsonFile(indexFile);
    assertObject(index, 'phase1 index');
    if (!Array.isArray(index.games) || index.games.length === 0) {
      throw new Error('phase1 index must contain a non-empty games array.');
    }

    if (configFile) {
      if (!fs.existsSync(configFile)) throw new Error(`Config file does not exist: ${configFile}`);
      report.files.config = fileInfo(configFile);
      const config = readJsonFile(configFile);
      assertObject(config, 'task config');
    }

    if (shutdownPolicyFile) {
      if (!fs.existsSync(shutdownPolicyFile)) throw new Error(`Shutdown policy file does not exist: ${shutdownPolicyFile}`);
      report.files.shutdown_policy = fileInfo(shutdownPolicyFile);
      const policy = readJsonFile(shutdownPolicyFile);
      assertObject(policy, 'shutdown policy');
      const mode = String(policy.mode || 'none').trim().toLowerCase();
      if (!['none', 'after_complete', 'before_deadline'].includes(mode)) {
        throw new Error(`Unsupported shutdown policy mode: ${mode}`);
      }
      if (mode === 'before_deadline' && !Number.isFinite(Date.parse(String(policy.deadline || '')))) {
        throw new Error('before_deadline shutdown policy requires a valid timezone-aware deadline.');
      }
    }

    const groupUrls = new Set();
    let totalCandidates = 0;
    for (let i = 0; i < index.games.length; i++) {
      const game = index.games[i];
      assertObject(game, `games[${i}]`);
      const gameName = String(game.game_name || '').trim();
      if (!gameName) throw new Error(`games[${i}].game_name is empty.`);
      const candidatesFile = resolveChildFile(game.candidates_file, indexFile);
      if (!candidatesFile || !fs.existsSync(candidatesFile)) {
        throw new Error(`Candidate file missing for ${gameName}: ${candidatesFile || '(empty)'}`);
      }
      const candidates = readJsonFile(candidatesFile);
      if (!Array.isArray(candidates)) throw new Error(`Candidate file for ${gameName} must contain a JSON array: ${candidatesFile}`);
      let validRows = 0;
      for (const row of candidates) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        validRows++;
        const url = String(row.group_url || row.url || '').trim();
        if (url) groupUrls.add(url.replace(/\/$/, '').toLowerCase());
      }
      if (validRows !== candidates.length) {
        report.warnings.push(`${gameName}: ${candidates.length - validRows} candidate rows are not JSON objects.`);
      }
      totalCandidates += candidates.length;
      report.games.push({
        game_name: gameName,
        candidates_file: fileInfo(candidatesFile),
        candidate_count: candidates.length,
        object_row_count: validRows,
      });
    }

    report.total_games = report.games.length;
    report.total_candidates = totalCandidates;
    report.unique_group_urls = groupUrls.size;
    report.ok = true;
  } catch (err) {
    report.errors.push(err && err.message ? err.message : String(err));
    report.error_code = err && err.code ? err.code : 'PHASE2_INPUT_VALIDATION_FAILED';
  }

  writeJsonAtomic(outReport, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
})();
