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

function renameOverwriting(src, dest) {
  if (fs.existsSync(dest)) {
    try { fs.unlinkSync(dest); } catch (_err) { /* ignore */ }
  }
  fs.renameSync(src, dest);
}

const args = parseArgs(process.argv.slice(2));
const file = path.resolve(args.file || '');
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node scripts/rewrite_partial_xlsx_with_formulas.js --file <partial_verified_rows.xlsx> [--out <output.xlsx>] [--games \"A|B|C\"]');
  process.exit(1);
}
const outFile = path.resolve(args.out || file);
const keepGames = args.games
  ? new Set(String(args.games).split('|').map((s) => s.trim()).filter(Boolean))
  : null;

const activeIndex = '活跃指数=当日新帖/社群规模';
const growthRate = '规模增速=上周新增/(社群规模-上周新增）';
const wbIn = XLSX.readFile(file, { cellFormula: true, cellDates: false });
const wsIn = wbIn.Sheets[wbIn.SheetNames[0]];
let rows = XLSX.utils.sheet_to_json(wsIn, { defval: '' });
if (keepGames) rows = rows.filter((row) => keepGames.has(row.game_name));
const fields = XLSX.utils.sheet_to_json(wsIn, { header: 1, range: 0, blankrows: false })[0] || [];

for (const field of [activeIndex, growthRate]) {
  if (!fields.includes(field)) fields.push(field);
}

const aoa = [fields].concat(rows.map((row) => fields.map((field) => {
  if (field === 'snapshot_date' || field === 'group_id') {
    return row[field] === undefined || row[field] === null ? '' : String(row[field]);
  }
  if (field === activeIndex || field === growthRate) return '';
  return row[field] ?? '';
})));

const ws = XLSX.utils.aoa_to_sheet(aoa);
const activeCol = fields.indexOf(activeIndex);
const growthCol = fields.indexOf(growthRate);
const dateCol = fields.indexOf('snapshot_date');
const groupIdCol = fields.indexOf('group_id');
for (let idx = 0; idx < rows.length; idx++) {
  const excelRow = idx + 2;
  const groupSize = Number(rows[idx].group_size) || 0;
  const todayPosts = Number(rows[idx].today_posts) || 0;
  const weekNewFans = Number(rows[idx].week_new_fans) || 0;
  if (activeCol >= 0) {
    ws[XLSX.utils.encode_cell({ r: idx + 1, c: activeCol })] = {
      t: 'n',
      f: `IFERROR(I${excelRow}/H${excelRow},"")`,
      v: groupSize ? todayPosts / groupSize : 0,
      z: '0.00%',
    };
  }
  if (growthCol >= 0) {
    ws[XLSX.utils.encode_cell({ r: idx + 1, c: growthCol })] = {
      t: 'n',
      f: `IFERROR(J${excelRow}/(H${excelRow}-J${excelRow}),"")`,
      v: groupSize - weekNewFans ? weekNewFans / (groupSize - weekNewFans) : 0,
      z: '0.00%',
    };
  }
  for (const colIdx of [dateCol, groupIdCol]) {
    if (colIdx < 0) continue;
    const ref = XLSX.utils.encode_cell({ r: idx + 1, c: colIdx });
    if (ws[ref]) {
      ws[ref].t = 's';
      ws[ref].z = '@';
    }
  }
}

const wbOut = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbOut, ws, wbIn.SheetNames[0] || 'verified_partial');
if (outFile === file) {
  const tmp = path.join(path.dirname(outFile), `.${path.basename(outFile)}.${process.pid}.${Date.now()}.tmp.xlsx`);
  XLSX.writeFile(wbOut, tmp);
  renameOverwriting(tmp, outFile);
} else {
  XLSX.writeFile(wbOut, outFile);
}

const counts = {};
for (const row of rows) counts[row.game_name] = (counts[row.game_name] || 0) + 1;
console.log(JSON.stringify({ ok: true, source: file, file: outFile, total: rows.length, counts }, null, 2));
