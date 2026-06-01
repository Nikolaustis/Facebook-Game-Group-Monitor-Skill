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

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasStrongRoxSignal(row) {
  const haystack = normalize([
    row.group_name,
    row.__matched_phrase,
    row.__source_queries,
  ].join(' '));

  if (/ragnarok\s*x/.test(haystack)) return { keep: true, reason: 'contains_ragnarok_x' };
  if (/ragnarokx/.test(haystack)) return { keep: true, reason: 'contains_ragnarokx' };
  if (/ragnarok\s*x\s*next\s*generation/.test(haystack)) return { keep: true, reason: 'contains_full_title' };
  if (/next\s*generation/.test(haystack) && /\brox\b/.test(haystack)) return { keep: true, reason: 'contains_rox_next_generation' };
  if (/仙境傳說|仙境传说/.test(haystack) && (/\brox\b/.test(haystack) || /ragnarok/.test(haystack))) {
    return { keep: true, reason: 'contains_ro_traditional_title' };
  }
  if (/ragnarok/.test(haystack) && /\brox\b/.test(haystack)) return { keep: true, reason: 'contains_ragnarok_and_rox' };

  return { keep: false, reason: 'weak_rox_only_or_unrelated' };
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || 'UNMAPPED';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function average(rows, key) {
  const vals = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  if (!vals.length) return '';
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

const args = parseArgs(process.argv.slice(2));
const runDir = path.resolve(args.dir || '');
const outXlsx = path.resolve(args.out || path.join(runDir, 'fb_monitoring_filtered_cleaned.xlsx'));
const outSummary = path.resolve(args.summary || path.join(runDir, 'fb_monitoring_filtered_cleaned_summary.json'));
const debugPath = path.join(runDir, 'debug_rows.json');

if (!runDir || !fs.existsSync(debugPath)) {
  throw new Error(`missing debug rows: ${debugPath}`);
}

const formulaFields = {
  activeIndex: '活跃指数=当日新帖/社群规模',
  growthRate: '规模增速=上周新增/(社群规模-上周新增）',
};
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
  formulaFields.activeIndex,
  formulaFields.growthRate,
  'existed_last_month',
  'is_relevant',
  'action',
  'action_reason',
  'risk_level',
  '__region_source',
  '__region_keyword_hits',
];

const debugRows = JSON.parse(fs.readFileSync(debugPath, 'utf8'));
const kept = [];
const removed = [];

for (const row of debugRows) {
  const decision = hasStrongRoxSignal(row);
  const out = { ...row };
  out.language = row.language_signal || row.language || '';
  out.group_id = String(row.group_id || '');
  out[formulaFields.activeIndex] = '';
  out[formulaFields.growthRate] = '';
  if (decision.keep) {
    kept.push({ ...out, __clean_reason: decision.reason });
  } else {
    removed.push({ ...out, __clean_reason: decision.reason });
  }
}

function buildSheet(rows, includeReason = false) {
  const sheetFields = includeReason ? fields.concat('__clean_reason') : fields;
  const aoa = [sheetFields].concat(rows.map((row) => sheetFields.map((field) => row[field] ?? '')));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let i = 0; i < rows.length; i++) {
    const excelRow = i + 2;
    const groupSize = Number(rows[i].group_size) || 0;
    const todayPosts = Number(rows[i].today_posts) || 0;
    const weekNewFans = Number(rows[i].week_new_fans) || 0;
    if (!includeReason) {
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
    }
    for (const field of ['snapshot_date', 'group_id']) {
      const col = sheetFields.indexOf(field);
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: col });
      if (ws[ref]) {
        ws[ref].t = 's';
        ws[ref].z = '@';
      }
    }
  }
  ws['!cols'] = sheetFields.map((field) => {
    if (field === 'snapshot_date') return { wch: 12, z: '@' };
    if (field === 'group_id') return { wch: 22, z: '@' };
    if (field === 'group_url') return { wch: 48 };
    if (field === 'group_name') return { wch: 46 };
    return { wch: 18 };
  });
  return ws;
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, buildSheet(kept, false), 'detail');
XLSX.utils.book_append_sheet(wb, buildSheet(removed, true), 'removed_review');
XLSX.writeFile(wb, outXlsx);

const thRows = kept.filter((row) => row.region === 'TH');
const vnRows = kept.filter((row) => row.region === 'VN');
const summary = {
  source_rows: debugRows.length,
  kept_rows: kept.length,
  removed_rows: removed.length,
  clean_rule: 'keep strong Ragnarok X / RagnarokX / Next Generation / 仙境傳說 signals; remove weak ROX-only rows',
  regions: countBy(kept, 'region'),
  languages: countBy(kept, 'language'),
  TH: thRows.length,
  VN: vnRows.length,
  TH_pct: kept.length ? Number(((thRows.length * 100) / kept.length).toFixed(2)) : 0,
  VN_pct: kept.length ? Number(((vnRows.length * 100) / kept.length).toFixed(2)) : 0,
  activity: {
    TH_avg_today_posts: average(thRows, 'today_posts'),
    VN_avg_today_posts: average(vnRows, 'today_posts'),
    TH_avg_week_new_fans: average(thRows, 'week_new_fans'),
    VN_avg_week_new_fans: average(vnRows, 'week_new_fans'),
  },
};
fs.writeFileSync(outSummary, JSON.stringify({ summary }, null, 2), 'utf8');

const check = XLSX.readFile(outXlsx, { cellDates: false });
const sheet = check.Sheets.detail;
console.log(JSON.stringify({
  out_xlsx: outXlsx,
  out_summary: outSummary,
  summary,
  A2: sheet.A2 && { v: sheet.A2.v, t: sheet.A2.t },
  G2: sheet.G2 && { v: sheet.G2.v, t: sheet.G2.t },
}, null, 2));
