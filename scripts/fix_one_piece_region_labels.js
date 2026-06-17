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

const DEFAULT_LANGUAGE_TO_REGION = {
  // Language is only an auxiliary fallback when group_name has no explicit country/region signal.
  // East Asia / Europe / LATAM / Africa are not inferred from broad languages such as Chinese,
  // Spanish, French, Portuguese, English, etc.
  Thai: 'TH',
  Vietnamese: 'VN',
  Indonesian: 'ID',
  Malay: 'MY',
  Filipino: 'PH',
  Lao: 'LA',
  Khmer: 'KH',
  Burmese: 'MM',
  Arabic: 'Middle East',
  Persian: 'Middle East',
};

const LANGUAGE_REGION_AUX_ALLOWED = new Set(Object.keys(DEFAULT_LANGUAGE_TO_REGION));

const LEGACY_REGION_OUTPUT_MAP = {
  // LATAM legacy country codes
  MX: 'LATAM', AR: 'LATAM', CL: 'LATAM', CO: 'LATAM', PE: 'LATAM', UY: 'LATAM', PY: 'LATAM', BO: 'LATAM', EC: 'LATAM', VE: 'LATAM', CR: 'LATAM', PA: 'LATAM', GT: 'LATAM', HN: 'LATAM', SV: 'LATAM', NI: 'LATAM', BZ: 'LATAM', CU: 'LATAM', DO: 'LATAM', HT: 'LATAM', JM: 'LATAM', TT: 'LATAM', PR: 'LATAM',
  // Broad-region remaps
  US: 'North America', USA: 'North America', CA: 'North America', GL: 'North America',
  IN: 'South Asia', PK: 'South Asia', BD: 'South Asia', LK: 'South Asia', NP: 'South Asia', BT: 'South Asia', MV: 'South Asia', AF: 'South Asia',
  KZ: 'Central Asia', KG: 'Central Asia', TJ: 'Central Asia', TM: 'Central Asia', UZ: 'Central Asia',
  ME: 'Middle East', MENA: 'Middle East',
  UK: 'EUR', GB: 'EUR', ES: 'EUR', PT: 'EUR', SE: 'EUR', NO: 'EUR', FI: 'EUR', DK: 'EUR', IE: 'EUR', BE: 'EUR', CH: 'EUR', AT: 'EUR', CZ: 'EUR', SK: 'EUR', HU: 'EUR', RO: 'EUR', BG: 'EUR', GR: 'EUR', UA: 'EUR', BY: 'EUR', GE: 'EUR', AM: 'EUR', AZ: 'EUR', CY: 'EUR',
  AU: 'Oceania', NZ: 'Oceania', PG: 'Oceania', FJ: 'Oceania', GU: 'Oceania', NC: 'Oceania', PF: 'Oceania',
  AFR: 'Africa', AFRC: 'Africa',
};

function normalizeRegionOutput(region) {
  const key = clean(region);
  if (!key) return '';
  return LEGACY_REGION_OUTPUT_MAP[key] || key;
}

const SAME_BUSINESS_REGION_BUCKET_MAP = {
  CN: 'EA', HK: 'EA', MO: 'EA', TW: 'EA', JP: 'EA', KR: 'EA', KP: 'EA', MN: 'EA', EA: 'EA',
  TH: 'SEA', VN: 'SEA', PH: 'SEA', ID: 'SEA', MY: 'SEA', SG: 'SEA', BN: 'SEA', LA: 'SEA', KH: 'SEA', MM: 'SEA', TL: 'SEA', SEA: 'SEA',
  'Middle East': 'Middle East',
  'Central Asia': 'Central Asia',
  'South Asia': 'South Asia',
  'North America': 'North America',
  LATAM: 'LATAM',
  BR: 'BR',
  Africa: 'Africa',
  TR: 'EUR', NL: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', PL: 'EUR', RU: 'EUR', EUR: 'EUR',
  Oceania: 'Oceania',
};

function normalizeSameBusinessRegionBucket(region) {
  const normalized = normalizeRegionOutput(region);
  return SAME_BUSINESS_REGION_BUCKET_MAP[normalized] || normalized || '';
}

function resolveSameBusinessRegionConflict(matchedRegions) {
  const regions = unique((matchedRegions || []).map((x) => normalizeRegionOutput(x)).filter(Boolean));
  if (regions.length <= 1) return regions[0] || '';
  const buckets = unique(regions.map((x) => normalizeSameBusinessRegionBucket(x)).filter(Boolean));
  if (buckets.length === 1) return buckets[0];
  return '';
}

const DEFAULT_COUNTRY_REGION_KEYWORDS = {
  // East Asia: single-country/territory hits output themselves; multi-country hits within EA fold to EA.
  CN: ['cn', 'china', 'mainland china', 'china mainland', '中国大陆', '中國大陸', '中国', '中國'],
  HK: ['hk', 'hong kong', '香港'],
  MO: ['mo', 'macau', 'macao', '澳门', '澳門'],
  TW: ['tw', 'taiwan', '台灣', '台湾'],
  JP: ['jp', 'japan', 'japanese', '日本'],
  KR: ['kr', 'south korea', 'korea server', 'korean server', 'korean', '한국', '대한민국'],
  KP: ['kp', 'north korea', 'dprk', '朝鲜', '朝鮮', '北韩', '北韓', '북한'],
  MN: ['mn', 'mongolia', 'mongolian', 'Монгол', '蒙古'],

  // Southeast Asia: single-country hits output themselves; multi-country hits within SEA fold to SEA.
  TH: ['th', 'thai', 'thailand', 'ประเทศไทย', 'ไทย'],
  VN: ['vn', 'viet nam', 'vietnam', 'việt nam'],
  PH: ['ph', 'pinoy', 'philippines', 'pilipinas'],
  ID: ['id', 'indo', 'indonesia'],
  MY: ['malaysia', 'malay', 'melayu'],
  SG: ['sg', 'singapore'],
  BN: ['brunei'],
  LA: ['laos', 'lao'],
  KH: ['cambodia', 'khmer'],
  MM: ['myanmar', 'burma', 'burmese'],
  TL: ['timor leste', 'east timor'],

  // Middle East: countries are unified as Middle East. Turkey is intentionally excluded and kept as TR.
  'Middle East': [
    'saudi arabia', 'ksa', 'saudi', 'السعودية',
    'uae', 'u.a.e.', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi', 'الإمارات',
    'qatar', 'قطر', 'kuwait', 'الكويت', 'bahrain', 'البحرين', 'oman', 'عمان', 'yemen', 'اليمن',
    'iraq', 'العراق', 'iran', 'persia', 'persian', 'ایران', 'ايران',
    'israel', 'إسرائيل', 'اسرائيل', 'jordan', 'الأردن', 'lebanon', 'لبنان',
    'syria', 'سوريا', 'palestine', 'palestinian', 'فلسطين', 'egypt', 'مصر'
  ],

  // Central Asia.
  'Central Asia': ['kazakhstan', 'kazakh', 'kz', 'қазақстан', 'киргизстан', 'kyrgyzstan', 'kyrgyz', 'kg', 'tajikistan', 'tajik', 'tj', 'turkmenistan', 'turkmen', 'tm', 'uzbekistan', 'uzbek', 'uz'],

  // South Asia.
  'South Asia': ['india', 'bharat', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'bhutan', 'maldives', 'afghanistan'],

  // North America.
  'North America': ['usa', 'u.s.', 'u.s.a.', 'united states', 'canada', 'greenland'],

  // LATAM: all Americas except US / Canada / Greenland / Brazil; includes listed territories.
  LATAM: [
    'mexico', 'méxico', 'mexicano', 'mexicana', 'argentina', 'chile', 'colombia', 'peru', 'perú', 'uruguay', 'paraguay', 'bolivia', 'ecuador', 'venezuela',
    'costa rica', 'panama', 'panamá', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'belize',
    'cuba', 'dominican republic', 'república dominicana', 'haiti', 'haití', 'jamaica', 'trinidad', 'tobago',
    'puerto rico', 'boricua', 'us virgin islands', 'u.s. virgin islands', 'virgin islands', 'guadeloupe', 'martinique', 'french guiana', 'guyane', 'aruba', 'curaçao', 'curacao',
    'latino', 'latinos', 'hispano', 'hispanos'
  ],

  // Brazil remains separate.
  BR: ['br', 'brasil', 'brazil', 'brasileiro', 'brasileira'],

  // Africa: Egypt is intentionally excluded and handled as Middle East above.
  Africa: [
    'south africa', 'nigeria', 'kenya', 'ghana', 'ethiopia', 'tanzania', 'uganda', 'rwanda', 'burundi', 'somalia', 'djibouti', 'eritrea',
    'sudan', 'south sudan', 'libya', 'algeria', 'الجزائر', 'morocco', 'المغرب', 'tunisia', 'تونس', 'mauritania',
    'senegal', 'gambia', 'guinea', 'guinea bissau', 'sierra leone', 'liberia', 'ivory coast', 'cote d ivoire', "côte d'ivoire", 'mali', 'burkina faso', 'niger', 'chad',
    'cameroon', 'central african republic', 'equatorial guinea', 'gabon', 'congo', 'dr congo', 'drc', 'democratic republic of congo',
    'angola', 'zambia', 'zimbabwe', 'mozambique', 'malawi', 'botswana', 'namibia', 'lesotho', 'eswatini', 'swaziland',
    'madagascar', 'mauritius', 'seychelles', 'comoros', 'cape verde', 'cabo verde', 'sao tome', 'são tomé'
  ],

  // Europe: Turkey / Netherlands / Germany / France / Italy / Poland / Russia are kept separate.
  TR: ['turkey', 'turkiye', 'türkiye', 'turkish', 'türk', 'turkce'],
  NL: ['netherlands', 'holland', 'dutch', 'nederland'],
  DE: ['germany', 'deutschland', 'german', 'deutsch'],
  FR: ['france', 'french', 'français', 'francais'],
  IT: ['italy', 'italia', 'italian', 'italiano'],
  PL: ['poland', 'polska', 'polish', 'polski'],
  RU: ['russia', 'russian', 'россия', 'русский'],
  EUR: [
    'united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'ireland',
    'spain', 'espana', 'españa', 'portugal', 'sweden', 'norway', 'finland', 'denmark', 'iceland',
    'belgium', 'belgie', 'belgië', 'switzerland', 'austria', 'czech republic', 'czechia', 'slovakia', 'hungary', 'romania', 'bulgaria', 'greece',
    'ukraine', 'belarus', 'lithuania', 'latvia', 'estonia', 'slovenia', 'croatia', 'serbia', 'bosnia', 'montenegro', 'albania', 'kosovo', 'north macedonia', 'moldova', 'malta',
    'georgia', 'armenia', 'azerbaijan', 'cyprus'
  ],

  // Oceania.
  Oceania: [
    'australia', 'new zealand', 'papua new guinea', 'png', 'fiji', 'samoa', 'tonga', 'vanuatu', 'solomon islands',
    'micronesia', 'palau', 'marshall islands', 'kiribati', 'nauru', 'tuvalu', 'guam', 'new caledonia', 'french polynesia', 'tahiti'
  ],
};

const DEFAULT_DIRECT_REGION_KEYWORDS = {
  EA: ['east asia', 'eastern asia', 'east asian', '东亚', '東亞'],
  SEA: ['southeast asia', 'south east asia', 'south-east asia', 'asean', 's.e.a.', 'sea server', 'sea players', 'sea region'],
  'Middle East': ['middle east', 'mena', 'gcc', 'gulf countries', 'arab countries', 'arab world', 'arabic'],
  'Central Asia': ['central asia', 'central asian'],
  'South Asia': ['south asia', 'south asian'],
  'North America': ['north america', 'north american'],
  LATAM: ['latam', 'latin america', 'latinoamerica', 'latinoamérica', 'america latina', 'américa latina'],
  Africa: ['africa', 'african'],
  EUR: ['europe', 'european', 'eur'],
  Oceania: ['oceania', 'pacific islands'],
};

function mergeKeywordMap(base, override) {
  const out = {};
  for (const [key, vals] of Object.entries(base || {})) {
    const mappedKey = normalizeRegionOutput(key);
    if (!mappedKey) continue;
    out[mappedKey] = unique([...(out[mappedKey] || []), ...(Array.isArray(vals) ? vals : []).map((x) => clean(x)).filter(Boolean)]);
  }
  if (override && typeof override === 'object') {
    for (const [key, vals] of Object.entries(override)) {
      const mappedKey = normalizeRegionOutput(key);
      if (!mappedKey) continue;
      const list = Array.isArray(vals) ? vals : [];
      out[mappedKey] = unique([...(out[mappedKey] || []), ...list.map((x) => clean(x)).filter(Boolean)]);
    }
  }
  return out;
}

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


function detectRegionByKeywordMap(groupName, regionKeywords, source) {
  if (!regionKeywords || typeof regionKeywords !== 'object') return { region: '', source: '', keyword_hits: [] };
  const fullText = clean(groupName || '');
  const compactText = normalizeCompact(fullText);
  const normText = ` ${normalizeWords(fullText)} `;
  const hits = [];
  for (const [region, keywords] of Object.entries(regionKeywords)) {
    const mappedRegion = normalizeRegionOutput(region);
    for (const keyword of Array.isArray(keywords) ? keywords : []) {
      if (phraseMatchesText(keyword, compactText, normText)) {
        hits.push({ region: mappedRegion, keyword: clean(keyword) });
        break;
      }
    }
  }
  const matchedRegions = unique(hits.map((x) => x.region).filter(Boolean));
  if (matchedRegions.length === 1) return { region: matchedRegions[0], source, keyword_hits: hits };
  if (matchedRegions.length > 1) {
    const sameBusinessRegion = resolveSameBusinessRegionConflict(matchedRegions);
    if (sameBusinessRegion) return { region: sameBusinessRegion, source: `${source}_same_business_region`, keyword_hits: hits };
    return { region: '', source: 'keyword_conflict', keyword_hits: hits };
  }
  return { region: '', source: '', keyword_hits: [] };
}

const countryRegionKeywords = mergeKeywordMap(DEFAULT_COUNTRY_REGION_KEYWORDS, null);
const directRegionKeywords = mergeKeywordMap(DEFAULT_DIRECT_REGION_KEYWORDS, null);

function detectRegionByGroupName(groupName) {
  const countryMatch = detectRegionByKeywordMap(groupName, countryRegionKeywords, 'country_keyword');
  if (countryMatch.source && countryMatch.source !== 'keyword_conflict' && countryMatch.region) return countryMatch;
  if (countryMatch.source === 'keyword_conflict') return countryMatch;
  const directRegionMatch = detectRegionByKeywordMap(groupName, directRegionKeywords, 'region_keyword');
  if (directRegionMatch.source && directRegionMatch.source !== 'keyword_conflict' && directRegionMatch.region) return directRegionMatch;
  if (directRegionMatch.source === 'keyword_conflict') return directRegionMatch;
  return { region: '', source: '', keyword_hits: [] };
}

function mapRegion(languageSignal, regionKeywordMatch) {
  if (regionKeywordMatch.source && regionKeywordMatch.source !== 'keyword_conflict' && regionKeywordMatch.region) return normalizeRegionOutput(regionKeywordMatch.region);
  if (regionKeywordMatch.source === 'keyword_conflict') return '';
  if (!LANGUAGE_REGION_AUX_ALLOWED.has(languageSignal)) return '';
  return normalizeRegionOutput(DEFAULT_LANGUAGE_TO_REGION[languageSignal] || '');
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
