const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { readJsonFile } = require('./json_io');

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
  // Recovery finalization follows the same contract as the live collector:
  // preserve one row per (group_url, game_name), including legitimate
  // multi-game groups, and collapse only same-game duplicates.
  const byUrl = new Map();
  const kept = [];
  for (const row of rows) {
    const groupUrl = String(row.group_url || '').trim();
    if (!groupUrl) {
      kept.push(row);
      continue;
    }
    if (!byUrl.has(groupUrl)) byUrl.set(groupUrl, []);
    byUrl.get(groupUrl).push(row);
  }

  const report = [];
  let droppedCollision = 0;
  let sameGameDuplicateRowsDropped = 0;
  let multiGameGroupsPreserved = 0;
  let multiGameRowsPreserved = 0;

  for (const [groupUrl, arr] of byUrl.entries()) {
    const byGame = new Map();
    arr.forEach((row, originalIndex) => {
      const gameKey = String(row.game_name || '').trim() || '__UNKNOWN_GAME__';
      if (!byGame.has(gameKey)) byGame.set(gameKey, []);
      byGame.get(gameKey).push({ row, originalIndex });
    });

    const selectedRows = [];
    const droppedSameGameRows = [];
    for (const candidates of byGame.values()) {
      const sorted = [...candidates].sort((a, b) => {
        const scoreDiff = (Number(b.row.__match_score) || 0) - (Number(a.row.__match_score) || 0);
        return scoreDiff || a.originalIndex - b.originalIndex;
      });
      selectedRows.push(sorted[0].row);
      if (sorted.length > 1) {
        const dropped = sorted.slice(1).map((item) => item.row);
        droppedSameGameRows.push(...dropped);
        droppedCollision += dropped.length;
        sameGameDuplicateRowsDropped += dropped.length;
      }
    }

    kept.push(...selectedRows);
    if (selectedRows.length > 1) {
      multiGameGroupsPreserved += 1;
      multiGameRowsPreserved += selectedRows.length;
      report.push({
        group_url: groupUrl,
        resolution: 'keep_each_matched_game',
        uniqueness_key: 'group_url + game_name',
        kept_games: selectedRows.map(collisionRowSummary),
        dropped_same_game_duplicates: droppedSameGameRows.map(collisionRowSummary),
      });
    } else if (droppedSameGameRows.length) {
      report.push({
        group_url: groupUrl,
        resolution: 'deduplicate_same_game_keep_highest_score',
        uniqueness_key: 'group_url + game_name',
        kept_games: selectedRows.map(collisionRowSummary),
        dropped_same_game_duplicates: droppedSameGameRows.map(collisionRowSummary),
      });
    }
  }

  return {
    rows: kept,
    report,
    droppedCollision,
    sameGameDuplicateRowsDropped,
    multiGameGroupsPreserved,
    multiGameRowsPreserved,
  };
}


function getGroupId(groupUrl) {
  const value = String(groupUrl || '');
  const match = value.match(/\/groups\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function normalizeManualReviewRow(row) {
  const out = {};
  for (const field of fields) out[field] = row[field] ?? '';
  out.snapshot_date = row.snapshot_date ?? '';
  out.region = row.region ?? '';
  out.language = row.language ?? row.language_signal ?? '';
  out.game_name = row.game_name ?? '';
  out.group_name = row.group_name ?? '';
  out.group_url = row.group_url ?? '';
  out.group_id = String(row.group_id || getGroupId(row.group_url));
  out.group_size = row.group_size ?? '';
  out.today_posts = row.today_posts ?? '';
  out.week_new_fans = row.week_new_fans ?? '';
  out['活跃指数=当日新帖/社群规模'] = '';
  out['规模增速=上周新增/(社群规模-上周新增）'] = '';
  out.__region_location = row.__region_location ?? row.about_location ?? '';
  for (const field of manualReviewExtraFields) out[field] = row[field] ?? '';
  out.language_signal = row.language_signal ?? out.language;
  out.about_location = row.about_location ?? out.__region_location;
  return out;
}

function buildDetailLikeSheet(rows, fields) {
  const normalizedRows = (rows || []).map(normalizeManualReviewRow);
  const aoa = [fields].concat(normalizedRows.map((row) => fields.map((field) => {
    if (field === '活跃指数=当日新帖/社群规模' || field === '规模增速=上周新增/(社群规模-上周新增）') return '';
    if (field === 'snapshot_date' || field === 'group_id') return row[field] === undefined || row[field] === null ? '' : String(row[field]);
    return row[field] ?? '';
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  normalizedRows.forEach((row, idx) => {
    const excelRow = idx + 2;
    const groupSize = Number(row.group_size) || 0;
    const todayPosts = Number(row.today_posts) || 0;
    const weekNewFans = Number(row.week_new_fans) || 0;
    ws[`K${excelRow}`] = { t: 'n', f: `IFERROR(I${excelRow}/H${excelRow},"")`, v: groupSize ? todayPosts / groupSize : 0, z: '0.00%' };
    ws[`L${excelRow}`] = { t: 'n', f: `IFERROR(J${excelRow}/(H${excelRow}-J${excelRow}),"")`, v: groupSize - weekNewFans ? weekNewFans / (groupSize - weekNewFans) : 0, z: '0.00%' };
    for (const field of ['snapshot_date', 'group_id']) {
      const col = fields.indexOf(field);
      const ref = XLSX.utils.encode_cell({ r: idx + 1, c: col });
      if (ws[ref]) { ws[ref].t = 's'; ws[ref].z = '@'; }
    }
  });
  ws['!cols'] = fields.map((field) => {
    if (field === 'snapshot_date') return { wch: 12, z: '@' };
    if (field === 'region' || field === 'language') return { wch: 14 };
    if (field === 'game_name') return { wch: 26 };
    if (field === 'group_name') return { wch: 46 };
    if (field === 'group_url') return { wch: 48 };
    if (field === 'group_id') return { wch: 22, z: '@' };
    if (field === '活跃指数=当日新帖/社群规模' || field === '规模增速=上周新增/(社群规模-上周新增）') return { wch: 18, z: '0.00%' };
    if (field === 'review_reason' || field === 'variant_threshold_applied') return { wch: 36 };
    if (field === 'source_query') return { wch: 28 };
    return { wch: 18 };
  });
  return ws;
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
  '__semantic_provider',
  '__semantic_model',
  '__semantic_status',
  '__semantic_trigger',
  '__semantic_location_intent',
  '__semantic_scope',
  '__semantic_confidence',
  '__semantic_candidate_places',
  '__semantic_explicit_regions',
  '__semantic_reason',
  '__semantic_cached',
  '__semantic_provider_chain',
  '__semantic_fallback_reason',
  '__geocoder_provider',
  '__geocoder_status',
  '__geocoder_source',
  '__geocoder_query',
  '__geocoder_attempted_queries',
  '__geocoder_endpoint',
  '__geocoder_error_reason',
  '__geocoder_country_code',
  '__geocoder_place_name',
  '__geocoder_admin1',
  '__geocoder_confidence',
];

const manualReviewExtraFields = [
  'language_signal',
  'about_location',
  'match_type',
  'matched_phrase',
  'negative_hit',
  'review_reason',
  'source_query',
  'query_variant_type',
  'source_is_seed_url',
  'variant_threshold_applied',
];
const manualReviewFields = [...fields, ...manualReviewExtraFields];

let sourceKind = 'partial_xlsx';
let rawRows = [];
let checkpoint = null;
let collisionReport = [];
let droppedCollision = 0;
let sameGameDuplicateRowsDropped = 0;
let multiGameGroupsPreserved = 0;
let multiGameRowsPreserved = 0;
if (fs.existsSync(checkpointSrc)) {
  checkpoint = readJsonFile(checkpointSrc);
  rawRows = Array.isArray(checkpoint.staged_rows) ? checkpoint.staged_rows : [];
  if (rawRows.length) {
    sourceKind = 'phase2_autosave_state';
    const resolved = resolveCollisions(rawRows);
    rawRows = resolved.rows;
    collisionReport = resolved.report;
    droppedCollision = resolved.droppedCollision;
    sameGameDuplicateRowsDropped = resolved.sameGameDuplicateRowsDropped;
    multiGameGroupsPreserved = resolved.multiGameGroupsPreserved;
    multiGameRowsPreserved = resolved.multiGameRowsPreserved;
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
    buildDetailLikeSheet(checkpoint.manual_review_rows, manualReviewFields),
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
writeJsonAtomic(outSummary, { summary, recovery: { source: sourceKind, checkpoint: checkpointSrc, partial_xlsx: src, dropped_collision: droppedCollision, same_game_duplicate_rows_dropped: sameGameDuplicateRowsDropped, multi_game_groups_preserved: multiGameGroupsPreserved, multi_game_rows_preserved: multiGameRowsPreserved } });
if (sourceKind === 'phase2_autosave_state') {
  writeJsonAtomic(outCollision, collisionReport);
  writeJsonAtomic(outAudit, { ...(checkpoint && checkpoint.stats ? checkpoint.stats : {}), recovered_from_checkpoint: true, dropped_collision: droppedCollision, same_game_duplicate_rows_dropped: sameGameDuplicateRowsDropped, multi_game_groups_preserved: multiGameGroupsPreserved, multi_game_rows_preserved: multiGameRowsPreserved, output_rows: finalRows.length });
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
  recovery: { source: sourceKind, checkpoint: checkpointSrc, partial_xlsx: src, dropped_collision: droppedCollision, same_game_duplicate_rows_dropped: sameGameDuplicateRowsDropped, multi_game_groups_preserved: multiGameGroupsPreserved, multi_game_rows_preserved: multiGameRowsPreserved },
}, null, 2));
