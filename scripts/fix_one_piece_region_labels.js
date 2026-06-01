const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function clean(s) {
  return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeWords(s) {
  return stripDiacritics(clean(s))
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCompact(s) {
  return normalizeWords(s).replace(/\s+/g, '');
}

function unique(list) {
  return Array.from(new Set(list));
}

const languageToRegion = {
  Thai: 'TH',
  Vietnamese: 'VN',
  Indonesian: 'ID',
  Malay: 'MY',
  Filipino: 'PH',
  Lao: 'LA',
  Khmer: 'KH',
  Burmese: 'MM',
};

const languageRegionAuxAllowed = new Set(Object.keys(languageToRegion));

const regionKeywords = {
  TH: ['th', 'thai', 'thailand'],
  VN: ['vn', 'viet nam', 'vietnam', 'việt nam'],
  PH: ['ph', 'pinoy', 'philippines', 'pilipinas'],
  ID: ['id', 'indo', 'indonesia'],
  MY: ['malaysia'],
  SG: ['sg', 'singapore'],
  LATAM: ['latam', 'latham', 'latin america', 'latinoamerica', 'latinoamérica', 'america latina', 'américa latina'],
  MX: ['mexico', 'méxico', 'mexicano', 'mexicana'],
  ES: ['spain', 'espana'],
  AR: ['argentina'],
  CL: ['chile'],
  CO: ['colombia'],
  PE: ['peru'],
  BR: ['br', 'brasil', 'brazil'],
  US: ['usa', 'u.s.', 'u.s.a.', 'united states'],
  CA: ['canada'],
  UK: ['uk', 'u.k.', 'united kingdom'],
  AU: ['australia'],
  JP: ['jp', 'japan'],
  KR: ['kr', 'korea', 'korean'],
  TW: ['tw', 'taiwan'],
  HK: ['hk', 'hong kong'],
  CN: ['cn', 'china'],
  IN: ['india', 'bharat'],
  RU: ['russia'],
  TR: ['turkey', 'turkiye'],
  DE: ['germany', 'deutschland'],
  FR: ['france'],
};

function phraseMatchesText(keyword, compactText, normText) {
  const cleanKeyword = clean(keyword);
  if (!cleanKeyword) return false;
  const compactKeyword = normalizeCompact(cleanKeyword);
  const normKeyword = normalizeWords(cleanKeyword).trim();
  if (!compactKeyword && !normKeyword) return false;
  const isPunctuatedShortCode = /[^\p{Letter}\p{Number}\s]/u.test(cleanKeyword) && compactKeyword.length <= 3;

  if (normKeyword && normKeyword.includes(' ')) {
    if (normText.includes(` ${normKeyword} `)) return true;
    if (!isPunctuatedShortCode && compactKeyword && compactText.includes(compactKeyword)) return true;
    return false;
  }

  if (compactKeyword && compactKeyword.length >= 3 && compactText.includes(compactKeyword)) return true;
  if (normKeyword && normText.includes(` ${normKeyword} `)) return true;
  return false;
}

function detectRegionByGroupName(groupName) {
  const fullText = clean(groupName || '');
  const compactText = normalizeCompact(fullText);
  const normText = ` ${normalizeWords(fullText)} `;
  const hits = [];
  for (const [region, keywords] of Object.entries(regionKeywords)) {
    for (const keyword of keywords) {
      if (phraseMatchesText(keyword, compactText, normText)) {
        hits.push({ region, keyword });
        break;
      }
    }
  }
  const matchedRegions = unique(hits.map((x) => x.region).filter(Boolean));
  if (matchedRegions.length === 1) return { region: matchedRegions[0], source: 'keyword', keyword_hits: hits };
  if (matchedRegions.length > 1) return { region: '', source: 'keyword_conflict', keyword_hits: hits };
  return { region: '', source: '', keyword_hits: [] };
}

function mapRegion(languageSignal, regionKeywordMatch) {
  if (regionKeywordMatch.source === 'keyword' && regionKeywordMatch.region) return regionKeywordMatch.region;
  if (regionKeywordMatch.source === 'keyword_conflict') return '';
  if (!languageRegionAuxAllowed.has(languageSignal)) return '';
  return languageToRegion[languageSignal] || '';
}

function summarize(rows) {
  const regionCounts = {};
  const languageCounts = {};
  for (const row of rows) {
    const regionKey = row.region || 'UNMAPPED';
    const langKey = row.language || 'Unknown';
    regionCounts[regionKey] = (regionCounts[regionKey] || 0) + 1;
    languageCounts[langKey] = (languageCounts[langKey] || 0) + 1;
  }
  const thRows = rows.filter((r) => r.region === 'TH');
  const vnRows = rows.filter((r) => r.region === 'VN');
  const avg = (list, field) => {
    const nums = list.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
    if (!nums.length) return 0;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  };
  const risk = {};
  for (const row of rows) risk[row.risk_level || ''] = (risk[row.risk_level || ''] || 0) + 1;
  return {
    total: rows.length,
    regions: regionCounts,
    languages: languageCounts,
    TH: thRows.length,
    VN: vnRows.length,
    TH_pct: rows.length ? Math.round((thRows.length / rows.length) * 10000) / 100 : 0,
    VN_pct: rows.length ? Math.round((vnRows.length / rows.length) * 10000) / 100 : 0,
    add: rows.filter((r) => r.action === 'add').length,
    update: rows.filter((r) => r.action === 'update').length,
    risk,
    activity: {
      TH_avg_today_posts: avg(thRows, 'today_posts'),
      VN_avg_today_posts: avg(vnRows, 'today_posts'),
      TH_avg_week_new_fans: avg(thRows, 'week_new_fans'),
      VN_avg_week_new_fans: avg(vnRows, 'week_new_fans'),
    },
  };
}

function main() {
  const runDir = path.resolve('runs/one_piece_bounty_fighting_20260521_160359');
  const input = path.join(runDir, 'fb_monitoring_filtered.xlsx');
  const output = path.join(runDir, 'fb_monitoring_filtered_region_fixed.xlsx');
  const rootOutput = path.resolve('One_Piece_FB_Monitoring_20260521_region_fixed.xlsx');
  const summaryOutput = path.join(runDir, 'fb_monitoring_filtered_region_fixed_summary.json');

  const wb = XLSX.readFile(input, { cellStyles: true });
  const detail = XLSX.utils.sheet_to_json(wb.Sheets.detail, { defval: '' });
  const manualReview = XLSX.utils.sheet_to_json(wb.Sheets.manual_review, { defval: '' });

  let changed = 0;
  for (const row of [...detail, ...manualReview]) {
    const beforeRegion = row.region || '';
    const beforeSource = row.__region_source || '';
    const beforeHits = row.__region_keyword_hits || '';
    const match = detectRegionByGroupName(row.group_name || '');
    row.region = mapRegion(row.language || '', match);
    row.__region_source = match.source || (row.region ? 'language_map' : '');
    row.__region_keyword_hits = (match.keyword_hits || []).map((x) => `${x.region}:${x.keyword}`).join('|');
    if (row.region !== beforeRegion || row.__region_source !== beforeSource || row.__region_keyword_hits !== beforeHits) changed++;
  }

  wb.Sheets.detail = XLSX.utils.json_to_sheet(detail);
  wb.Sheets.manual_review = XLSX.utils.json_to_sheet(manualReview);
  XLSX.writeFile(wb, output, { bookType: 'xlsx' });
  XLSX.writeFile(wb, rootOutput, { bookType: 'xlsx' });

  const summary = {
    summary: summarize(detail),
    changed_region_rows_in_detail_and_manual_review: changed,
    note: 'Recomputed region fields with punctuated short-code matching fixed. Other collected fields were not changed.',
  };
  fs.writeFileSync(summaryOutput, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    input,
    output,
    rootOutput,
    summaryOutput,
    changed,
    summary: summary.summary,
  }, null, 2));
}

main();
