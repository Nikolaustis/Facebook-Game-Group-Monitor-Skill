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
    .replace(/[\s:：_\-–—|()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(text) {
  return normalize(text).replace(/\s+/g, '');
}

function evidence(row) {
  return {
    loose: normalize([
      row.game_name,
      row.group_name,
      row.__matched_phrase,
      row.__source_queries,
    ].join(' ')),
    tight: compact([
      row.game_name,
      row.group_name,
      row.__matched_phrase,
      row.__source_queries,
    ].join(' ')),
  };
}

const RULES = {
  'Ragnarok: The New World': [
    ['contains_ragnarok_the_new_world', (e) => e.tight.includes('ragnarokthenewworld')],
    ['contains_new_world_with_ragnarok', (e) => e.loose.includes('new world') && e.loose.includes('ragnarok')],
    ['contains_world_journey_title', (e) => e.tight.includes('ro仙境傳說世界之旅') || e.tight.includes('ro仙境传说世界之旅') || e.tight.includes('世界之旅')],
  ],
  'Ragnarok M Eternal Love': [
    ['contains_ragnarok_m_eternal_love', (e) => e.tight.includes('ragnarokmeternallove')],
    ['contains_eternal_love_with_ragnarok', (e) => e.loose.includes('eternal love') && e.loose.includes('ragnarok') && !e.loose.includes('classic')],
    ['contains_guardian_eternal_love', (e) => (e.tight.includes('守護永恆的愛') || e.tight.includes('守护永恒的爱')) && !e.loose.includes('classic')],
  ],
  'Ragnarok M: Classic': [
    ['contains_ragnarok_m_classic', (e) => e.tight.includes('ragnarokmclassic')],
    ['contains_eternal_love_classic', (e) => (e.tight.includes('守護永恆的愛classic') || e.tight.includes('守护永恒的爱classic') || e.tight.includes('eternalloveclassic'))],
    ['contains_classic_with_ragnarok_m', (e) => e.loose.includes('classic') && e.loose.includes('ragnarok m')],
  ],
  'Ragnarok Origin Classic': [
    ['contains_ragnarok_origin_classic', (e) => e.tight.includes('ragnarokoriginclassic')],
    ['contains_origin_classic_with_ragnarok', (e) => e.loose.includes('origin classic') && e.loose.includes('ragnarok')],
    ['contains_love_beginning_classic', (e) => (e.tight.includes('愛如初見classic') || e.tight.includes('爱如初见classic'))],
  ],
  'Ragnarok X: Next Generation': [
    ['contains_ragnarok_x', (e) => /ragnarok\s*x/.test(e.loose) || e.tight.includes('ragnarokx')],
    ['contains_rox_next_generation', (e) => e.loose.includes('next generation') && /\brox\b/.test(e.loose)],
    ['contains_new_generation_title', (e) => e.tight.includes('ro仙境傳說新世代的誕生') || e.tight.includes('ro仙境传说新世代的诞生') || e.tight.includes('新世代的誕生') || e.tight.includes('新世代的诞生')],
  ],
  'Ragnarok: Midgard Senki': [
    ['contains_midgard_senki', (e) => e.tight.includes('midgardsenki')],
    ['contains_midgard_with_ragnarok', (e) => e.loose.includes('midgard') && e.loose.includes('ragnarok')],
  ],
};

function decide(row) {
  const rules = RULES[row.game_name] || [];
  const e = evidence(row);
  for (const [reason, fn] of rules) {
    if (fn(e)) return { keep: true, reason };
  }
  return { keep: false, reason: 'no_strong_game_specific_signal' };
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
const debugPath = path.join(runDir, 'debug_rows.json');
const outXlsx = path.resolve(args.out || path.join(runDir, 'fb_monitoring_filtered_strict_cleaned.xlsx'));
const outSummary = path.resolve(args.summary || path.join(runDir, 'fb_monitoring_filtered_strict_cleaned_summary.json'));

if (!fs.existsSync(debugPath)) throw new Error(`missing debug rows: ${debugPath}`);

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

const kept = [];
const removed = [];
for (const row of JSON.parse(fs.readFileSync(debugPath, 'utf8'))) {
  const out = { ...row };
  out.language = row.language_signal || row.language || '';
  out.group_id = String(row.group_id || '');
  out[formulaFields.activeIndex] = '';
  out[formulaFields.growthRate] = '';
  const decision = decide(out);
  out.__clean_reason = decision.reason;
  if (decision.keep) kept.push(out);
  else removed.push(out);
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
      ws[`K${excelRow}`] = { t: 'n', f: `IFERROR(I${excelRow}/H${excelRow},"")`, v: groupSize ? todayPosts / groupSize : 0, z: '0.00%' };
      ws[`L${excelRow}`] = { t: 'n', f: `IFERROR(J${excelRow}/(H${excelRow}-J${excelRow}),"")`, v: groupSize - weekNewFans ? weekNewFans / (groupSize - weekNewFans) : 0, z: '0.00%' };
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
XLSX.utils.book_append_sheet(wb, buildSheet(kept), 'detail');
XLSX.utils.book_append_sheet(wb, buildSheet(removed, true), 'removed_review');
XLSX.writeFile(wb, outXlsx);

const thRows = kept.filter((row) => row.region === 'TH');
const vnRows = kept.filter((row) => row.region === 'VN');
const summary = {
  source_rows: kept.length + removed.length,
  kept_rows: kept.length,
  removed_rows: removed.length,
  kept_by_game: countBy(kept, 'game_name'),
  removed_by_game: countBy(removed, 'game_name'),
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

console.log(JSON.stringify({ out_xlsx: outXlsx, out_summary: outSummary, summary }, null, 2));
