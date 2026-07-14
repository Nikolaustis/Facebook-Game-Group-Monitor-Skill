const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function average(rows, key) {
  const vals = rows.map((r) => Number(r[key])).filter(Number.isFinite);
  if (!vals.length) return '';
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || 'UNMAPPED';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function renameOverwriting(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (_err) {
    if (fs.existsSync(dest)) {
      try { fs.unlinkSync(dest); } catch (_e) { /* ignore */ }
    }
    fs.renameSync(src, dest);
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  renameOverwriting(tmp, file);
}

function writeWorkbookAtomic(file, wb) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp.xlsx`);
  try {
    XLSX.writeFile(wb, tmp, { bookType: 'xlsx', cellStyles: true });
    renameOverwriting(tmp, file);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
    throw err;
  }
}

function collisionRowSummary(r) {
  return {
    game_name: r.game_name,
    match_type: r.__match_type,
    match_score: r.__match_score,
    matched_phrase: r.__matched_phrase,
    source_query: r.__source_query,
    query_variant_type: r.__query_variant_type,
    variant_threshold_applied: r.__variant_threshold_applied,
  };
}

function resolveCollisions(rows) {
  const byUrl = new Map();
  for (const row of rows) {
    if (!row.group_url) continue;
    if (!byUrl.has(row.group_url)) byUrl.set(row.group_url, []);
    byUrl.get(row.group_url).push(row);
  }

  const kept = [];
  const report = [];
  let droppedCollision = 0;
  const seenUrls = new Set(byUrl.keys());
  for (const row of rows) {
    if (!row.group_url || seenUrls.has(row.group_url)) continue;
    kept.push(row);
  }

  for (const [groupUrl, arr] of byUrl.entries()) {
    if (arr.length === 1) {
      kept.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort((a, b) => (Number(b.__match_score) || 0) - (Number(a.__match_score) || 0));
    const topScore = Number(sorted[0].__match_score) || 0;
    const topRows = sorted.filter((r) => (Number(r.__match_score) || 0) === topScore);
    if (topRows.length === 1) {
      kept.push(topRows[0]);
      droppedCollision += sorted.length - 1;
      report.push({
        group_url: groupUrl,
        resolution: 'keep_highest_score',
        kept_game_name: topRows[0].game_name,
        kept_match_type: topRows[0].__match_type,
        kept_match_score: topScore,
        kept_source_query: topRows[0].__source_query,
        kept_query_variant_type: topRows[0].__query_variant_type,
        dropped_games: sorted.slice(1).map(collisionRowSummary),
      });
      continue;
    }
    droppedCollision += sorted.length;
    report.push({
      group_url: groupUrl,
      resolution: 'drop_all_tied',
      kept_game_name: '',
      kept_match_type: '',
      kept_match_score: topScore,
      dropped_games: sorted.map(collisionRowSummary),
    });
  }
  return { rows: kept, report, droppedCollision };
}


function buildPlainSheet(rows, fields) {
  const aoa = [fields].concat((rows || []).map((row) => fields.map((field) => row[field] ?? '')));
  return XLSX.utils.aoa_to_sheet(aoa);
}

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(args.dir || '');
const snapshotDate = args['snapshot-date'] || new Date().toISOString().slice(0, 10);
const src = path.join(dir, 'partial_verified_rows.xlsx');
const checkpointSrc = path.join(dir, 'phase2_autosave_state.json');
const outXlsx = path.join(dir, 'fb_monitoring_filtered.xlsx');
const outSummary = path.join(dir, 'fb_monitoring_filtered_summary.json');
const outCollision = path.join(dir, 'collision_report.json');
const outAudit = path.join(dir, 'audit_stats.json');

if (!dir || (!fs.existsSync(checkpointSrc) && !fs.existsSync(src))) {
  throw new Error(`missing recovery source: ${checkpointSrc} or ${src}`);
}

const fields = [
  'snapshot_date',
  'region',
  'language',
  'game_name',
  'group_name',
  'group_url',
  'group_id',
  'group_size',
  'today_posts',
  'week_new_fans',
  '活跃指数=当日新帖/社群规模',
  '规模增速=上周新增/(社群规模-上周新增）',
  'existed_last_month',
  'is_relevant',
  'action',
  'action_reason',
  'risk_level',
  '__region_source',
  '__region_keyword_hits',
  '__region_location',
];

let sourceKind = 'partial_xlsx';
let rawRows = [];
let checkpoint = null;
let collisionReport = [];
let droppedCollision = 0;
if (fs.existsSync(checkpointSrc)) {
  checkpoint = JSON.parse(fs.readFileSync(checkpointSrc, 'utf8'));
  rawRows = Array.isArray(checkpoint.staged_rows) ? checkpoint.staged_rows : [];
  if (rawRows.length) {
    sourceKind = 'phase2_autosave_state';
    const resolved = resolveCollisions(rawRows);
    rawRows = resolved.rows;
    collisionReport = resolved.report;
    droppedCollision = resolved.droppedCollision;
  }
}
if (!rawRows.length && fs.existsSync(src)) {
  const wb0 = XLSX.readFile(src, { cellDates: false });
  const sh0 = wb0.Sheets[wb0.SheetNames[0]];
  rawRows = XLSX.utils.sheet_to_json(sh0, { defval: '', raw: false });
  sourceKind = 'partial_xlsx';
}
const finalRows = rawRows.map((row) => {
  const out = {};
  for (const field of fields) out[field] = row[field] ?? '';
  out.snapshot_date = snapshotDate;
  out.group_id = String(out.group_id || '');
  out.language = out.language || row.language_signal || '';
  out['活跃指数=当日新帖/社群规模'] = '';
  out['规模增速=上周新增/(社群规模-上周新增）'] = '';
  return out;
});

const aoa = [fields].concat(finalRows.map((row) => fields.map((field) => row[field] ?? '')));
const ws = XLSX.utils.aoa_to_sheet(aoa);

for (let i = 0; i < finalRows.length; i++) {
  const excelRow = i + 2;
  const groupSize = Number(finalRows[i].group_size) || 0;
  const todayPosts = Number(finalRows[i].today_posts) || 0;
  const weekNewFans = Number(finalRows[i].week_new_fans) || 0;
  ws[`K${excelRow}`] = {
    t: 'n',
    f: `IFERROR(I${excelRow}/H${excelRow},"")`,
    v: groupSize ? todayPosts / groupSize : 0,
    z: '0.00%',
  };
  ws[`L${excelRow}`] = {
    t: 'n',
    f: `IFERROR(J${excelRow}/(H${excelRow}-J${excelRow}),"")`,
    v: groupSize - weekNewFans ? weekNewFans / (groupSize - weekNewFans) : 0,
    z: '0.00%',
  };
  for (const field of ['snapshot_date', 'group_id']) {
    const col = fields.indexOf(field);
    const ref = XLSX.utils.encode_cell({ r: i + 1, c: col });
    if (ws[ref]) {
      ws[ref].t = 's';
      ws[ref].z = '@';
    }
  }
}

ws['!cols'] = fields.map((field) => {
  if (field === 'snapshot_date') return { wch: 12, z: '@' };
  if (field === 'group_id') return { wch: 22, z: '@' };
  if (field === 'group_url') return { wch: 48 };
  if (field === 'group_name') return { wch: 42 };
  if (field === '活跃指数=当日新帖/社群规模' || field === '规模增速=上周新增/(社群规模-上周新增）') return { wch: 18, z: '0.00%' };
  return { wch: 18 };
});

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'detail');
if (checkpoint && Array.isArray(checkpoint.manual_review_rows)) {
  XLSX.utils.book_append_sheet(
    wb,
    buildPlainSheet(checkpoint.manual_review_rows, [
      'snapshot_date',
      'game_name',
      'group_name',
      'group_url',
      'group_size',
      'today_posts',
      'week_new_fans',
      'language_signal',
      'region',
      'about_location',
      'match_type',
      'matched_phrase',
      'negative_hit',
      'review_reason',
      'source_query',
      'query_variant_type',
      'source_is_seed_url',
      'variant_threshold_applied',
    ]),
    'manual_review'
  );
}
writeWorkbookAtomic(outXlsx, wb);

const thRows = finalRows.filter((row) => row.region === 'TH');
const vnRows = finalRows.filter((row) => row.region === 'VN');
const summary = {
  partial_finalized: true,
  recovery_source: sourceKind,
  total: finalRows.length,
  regions: countBy(finalRows, 'region'),
  languages: countBy(finalRows, 'language'),
  TH: thRows.length,
  VN: vnRows.length,
  TH_pct: finalRows.length ? Number(((thRows.length * 100) / finalRows.length).toFixed(2)) : 0,
  VN_pct: finalRows.length ? Number(((vnRows.length * 100) / finalRows.length).toFixed(2)) : 0,
  activity: {
    TH_avg_today_posts: average(thRows, 'today_posts'),
    VN_avg_today_posts: average(vnRows, 'today_posts'),
    TH_avg_week_new_fans: average(thRows, 'week_new_fans'),
    VN_avg_week_new_fans: average(vnRows, 'week_new_fans'),
  },
};
writeJsonAtomic(outSummary, { summary, recovery: { source: sourceKind, checkpoint: checkpointSrc, partial_xlsx: src, dropped_collision: droppedCollision } });
if (sourceKind === 'phase2_autosave_state') {
  writeJsonAtomic(outCollision, collisionReport);
  writeJsonAtomic(outAudit, { ...(checkpoint && checkpoint.stats ? checkpoint.stats : {}), recovered_from_checkpoint: true, dropped_collision: droppedCollision, output_rows: finalRows.length });
}

const check = XLSX.readFile(outXlsx, { cellDates: false });
const sh = check.Sheets[check.SheetNames[0]];
const headers = XLSX.utils.sheet_to_json(sh, { header: 1, range: 0, blankrows: false })[0];
console.log(JSON.stringify({
  file: path.resolve(outXlsx),
  rows: finalRows.length,
  headers,
  A2: sh.A2 && { v: sh.A2.v, t: sh.A2.t },
  G2: sh.G2 && { v: sh.G2.v, t: sh.G2.t },
  summary,
  recovery: { source: sourceKind, checkpoint: checkpointSrc, partial_xlsx: src, dropped_collision: droppedCollision },
}, null, 2));
