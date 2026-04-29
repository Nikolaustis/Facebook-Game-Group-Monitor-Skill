const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const XLSX = require('xlsx');

function clean(s) {
  return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

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

function toInt(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = parseInt(String(v).replace(/[,+\s]/g, ''), 10);
  return Number.isFinite(n) ? n : '';
}

function getGroupId(groupUrl) {
  const m = (groupUrl || '').match(/facebook\.com\/groups\/(\d+)(?:[/?#]|$)/i);
  return m ? m[1] : '';
}

function countThaiChars(s) {
  const m = (s || '').match(/[\u0E00-\u0E7F]/g);
  return m ? m.length : 0;
}

function countVnDiacritics(s) {
  const m = (s || '').match(/[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/g);
  return m ? m.length : 0;
}

function countChineseChars(s) {
  const m = (s || '').match(/[\u4E00-\u9FFF]/g);
  return m ? m.length : 0;
}

function countEnglishLetters(s) {
  const m = (s || '').match(/[A-Za-z]/g);
  return m ? m.length : 0;
}

function countPattern(s, pattern) {
  const m = (s || '').match(pattern);
  return m ? m.length : 0;
}

function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const DEFAULT_LANGUAGE_KEYWORDS = {
  Thai: ['thai', 'thailand'],
  Vietnamese: ['vietnam', 'viet nam', 'viet', 'thanh vien', 'bai viet', 'nhom'],
  Chinese: ['chinese'],
  Spanish: ['espanol', 'latam', 'latinoamerica', 'latin america', 'hispano', 'guias', 'tratos', 'ventas', 'compra', 'venta', 'intercambio', 'frutas'],
  Portuguese: ['portugues', 'brasil', 'brazil', 'comprar', 'vender', 'troca', 'trocas', 'jogadores'],
  Indonesian: ['indonesia', 'indonesian', 'indo', 'jual beli', 'komunitas', 'grup', 'akun'],
  Malay: ['malaysia', 'malay', 'melayu', 'jual beli', 'komuniti'],
  Filipino: ['philippines', 'filipino', 'pinoy', 'pilipinas', 'benta', 'bili', 'tambayan'],
  Japanese: ['japan', 'japanese'],
  Korean: ['korea', 'korean'],
  French: ['francais', 'france'],
  German: ['deutsch', 'german', 'deutschland'],
  Russian: ['russian', 'russia'],
  Arabic: ['arabic'],
  Turkish: ['turkish', 'turkey', 'turkiye'],
  Hindi: ['hindi', 'india'],
  English: ['english', 'global', 'international', 'worldwide'],
};

const SCRIPT_LANGUAGE_PATTERNS = {
  Thai: /[\u0E00-\u0E7F]/g,
  Vietnamese: /[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/g,
  Chinese: /[\u4E00-\u9FFF]/g,
  Japanese: /[\u3040-\u30FF]/g,
  Korean: /[\uAC00-\uD7AF]/g,
  Russian: /[\u0400-\u04FF]/g,
  Arabic: /[\u0600-\u06FF]/g,
  Hindi: /[\u0900-\u097F]/g,
};

const DEFAULT_LANGUAGE_TO_REGION = {
  Thai: 'TH',
  Vietnamese: 'VN',
  Chinese: 'CN',
};

const DEFAULT_REGION_KEYWORDS = {
  TH: ['th', 'thai', 'thailand'],
  VN: ['vn', 'viet nam', 'vietnam'],
  PH: ['ph', 'pinoy', 'philippines', 'pilipinas'],
  ID: ['id', 'indo', 'indonesia'],
  MY: ['malaysia'],
  SG: ['sg', 'singapore'],
  LATAM: ['latam', 'latin america', 'latinoamerica'],
  MX: ['mexico'],
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

function mergeKeywordMap(base, override) {
  const out = {};
  for (const [key, vals] of Object.entries(base || {})) {
    out[key] = Array.isArray(vals) ? [...vals] : [];
  }
  if (override && typeof override === 'object') {
    for (const [key, vals] of Object.entries(override)) {
      const list = Array.isArray(vals) ? vals : [];
      out[key] = unique([...(out[key] || []), ...list.map((x) => clean(x)).filter(Boolean)]);
    }
  }
  return out;
}

function phraseCount(text, phrases) {
  const asciiText = ` ${stripDiacritics(clean(text).toLowerCase()).replace(/[^\p{Letter}\p{Number}]+/gu, ' ')} `;
  let count = 0;
  for (const phrase of phrases || []) {
    const normalized = stripDiacritics(clean(phrase).toLowerCase()).replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
    if (normalized && asciiText.includes(` ${normalized} `)) count++;
  }
  return count;
}

function detectLanguageSignal(groupName, aboutText, snippet) {
  const fullText = clean(`${groupName || ''}\n${aboutText || ''}\n${snippet || ''}`);
  const enChars = countEnglishLetters(fullText);
  const scores = {};

  for (const [lang, pattern] of Object.entries(SCRIPT_LANGUAGE_PATTERNS)) {
    scores[lang] = (scores[lang] || 0) + countPattern(fullText, pattern) * 2;
  }
  for (const [lang, phrases] of Object.entries(DEFAULT_LANGUAGE_KEYWORDS)) {
    // Group content decides language; group-name keywords only add a smaller tie-break signal.
    scores[lang] = (scores[lang] || 0) + phraseCount(fullText, phrases) * 8 + phraseCount(groupName || '', phrases) * 4;
  }
  if (enChars >= 40) scores.English = (scores.English || 0) + 8;

  const ranked = Object.entries(scores)
    .filter(([, score]) => score >= 8)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'Unknown';
  if (ranked.length > 1 && ranked[0][1] < ranked[1][1] + 6) return 'Mixed';
  return ranked[0][0];
}

function defaultLanguageToRegion(languageSignal) {
  return DEFAULT_LANGUAGE_TO_REGION[languageSignal] || '';
}
function phraseMatchesText(keyword, compactText, normText) {
  const cleanKeyword = clean(keyword);
  if (!cleanKeyword) return false;
  const compactKeyword = normalizeCompact(cleanKeyword);
  const normKeyword = normalizeWords(cleanKeyword).trim();
  if (!compactKeyword && !normKeyword) return false;

  if (normKeyword && normKeyword.includes(' ')) {
    if (normText.includes(` ${normKeyword} `)) return true;
    if (compactKeyword && compactText.includes(compactKeyword)) return true;
    return false;
  }

  if (compactKeyword && compactKeyword.length >= 3 && compactText.includes(compactKeyword)) {
    return true;
  }

  if (normKeyword && normText.includes(` ${normKeyword} `)) {
    return true;
  }

  return false;
}

function detectRegionByKeywords(groupName, aboutText, snippet, regionKeywords) {
  if (!regionKeywords || typeof regionKeywords !== 'object') {
    return { region: '', source: '', keyword_hits: [] };
  }

  const fullText = clean(`${groupName || ''}\n${aboutText || ''}\n${snippet || ''}`);
  const compactText = normalizeCompact(fullText);
  const normText = ` ${normalizeWords(fullText)} `;
  const hits = [];

  for (const [region, keywords] of Object.entries(regionKeywords)) {
    const list = Array.isArray(keywords) ? keywords : [];
    for (const keyword of list) {
      if (!clean(keyword)) continue;
      if (!phraseMatchesText(keyword, compactText, normText)) continue;
      hits.push({ region: clean(region), keyword: clean(keyword) });
      break;
    }
  }

  const matchedRegions = unique(hits.map((x) => x.region).filter(Boolean));
  if (matchedRegions.length === 1) {
    return { region: matchedRegions[0], source: 'keyword', keyword_hits: hits };
  }
  if (matchedRegions.length > 1) {
    return { region: '', source: 'keyword_conflict', keyword_hits: hits };
  }
  return { region: '', source: '', keyword_hits: [] };
}

function mapRegion(languageSignal, languageToRegion, regionKeywordMatch) {
  if (regionKeywordMatch?.source === 'keyword' && regionKeywordMatch.region) {
    return regionKeywordMatch.region;
  }
  if (regionKeywordMatch?.source === 'keyword_conflict') {
    return '';
  }
  if (languageToRegion && Object.prototype.hasOwnProperty.call(languageToRegion, languageSignal)) {
    return clean(languageToRegion[languageSignal] || '');
  }
  return defaultLanguageToRegion(languageSignal);
}

function normalizeCompact(s) {
  return clean(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function normalizeWords(s) {
  return clean(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ');
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function tokenizeStrong(s) {
  const stop = new Set(['the','and','for','with','from','this','that','your','game','games','group','official','mobile','online','of','on','to','in','a','an','m']);
  return unique(
    normalizeWords(s)
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && !stop.has(x))
  );
}

function buildGameProfile(gameName, aliases) {
  const rawPhrases = unique([gameName].concat(Array.isArray(aliases) ? aliases : []).map((s) => clean(s)).filter(Boolean));
  const compactPhrases = unique(rawPhrases.map((s) => normalizeCompact(s)).filter(Boolean));
  const strongTokens = unique(rawPhrases.flatMap((s) => tokenizeStrong(s)));
  return { gameName, rawPhrases, compactPhrases, strongTokens };
}

function buildGameProfileV3(gameName, aliases, siblingTitles, ipRoots) {
  const base = buildGameProfile(gameName, aliases);
  const siblingRawPhrases = unique((Array.isArray(siblingTitles) ? siblingTitles : []).map((s) => clean(s)).filter(Boolean));
  const siblingCompactPhrases = unique(siblingRawPhrases.map((s) => normalizeCompact(s)).filter(Boolean));
  const ipRootRawPhrases = unique(
    ((Array.isArray(ipRoots) && ipRoots.length ? ipRoots : base.strongTokens.slice(0, 1)) || [])
      .map((s) => clean(s))
      .filter(Boolean)
  );
  const ipRootCompactPhrases = unique(ipRootRawPhrases.map((s) => normalizeCompact(s)).filter(Boolean));
  return {
    ...base,
    siblingRawPhrases,
    siblingCompactPhrases,
    ipRootRawPhrases,
    ipRootCompactPhrases,
  };
}

function phrasePresent(compactText, compactPhrases) {
  let best = '';
  for (const p of compactPhrases) {
    if (p && compactText.includes(p) && p.length > best.length) best = p;
  }
  return best;
}

function allStrongTokensPresent(normText, strongTokens) {
  if (!strongTokens.length) return false;
  const padded = ` ${normText} `;
  return strongTokens.every((tk) => padded.includes(` ${tk} `));
}

function matchGame(profile, groupName, aboutText, snippet) {
  const fullText = clean(`${groupName || ''}\n${aboutText || ''}\n${snippet || ''}`);
  const compactGroup = normalizeCompact(groupName || '');
  const compactFull = normalizeCompact(fullText);
  const exactGroup = phrasePresent(compactGroup, profile.compactPhrases);
  const negativeGroup = phrasePresent(compactGroup, profile.siblingCompactPhrases || []);

  if (negativeGroup && (!exactGroup || negativeGroup.length > exactGroup.length)) {
    return {
      matched: false,
      score: 0,
      type: 'sibling_title_in_group_name',
      phrase: '',
      negative_hit: negativeGroup,
      review_reason: 'more_specific_sibling_title_in_group_name',
      manual_review: true,
    };
  }

  if (exactGroup) {
    return {
      matched: true,
      score: 300 + exactGroup.length,
      type: 'exact_phrase_in_group_name',
      phrase: exactGroup,
      negative_hit: '',
      review_reason: '',
      manual_review: false,
    };
  }
  if (negativeGroup) {
    return {
      matched: false,
      score: 0,
      type: 'sibling_title_in_group_name',
      phrase: '',
      negative_hit: negativeGroup,
      review_reason: 'sibling_title_in_group_name',
      manual_review: true,
    };
  }

  const exactFull = phrasePresent(compactFull, profile.compactPhrases);
  if (exactFull) {
    return {
      matched: false,
      score: 240 + exactFull.length,
      type: 'exact_phrase_in_full_text',
      phrase: exactFull,
      negative_hit: '',
      review_reason: 'target_title_only_in_full_text',
      manual_review: true,
    };
  }

  const ipRootHit = phrasePresent(compactGroup, profile.ipRootCompactPhrases || []);
  if (ipRootHit) {
    return {
      matched: false,
      score: 0,
      type: 'ip_root_in_group_name',
      phrase: '',
      negative_hit: '',
      review_reason: 'ip_root_in_group_name_without_full_title',
      manual_review: true,
    };
  }

  return {
    matched: false,
    score: 0,
    type: 'no_match',
    phrase: '',
    negative_hit: '',
    review_reason: '',
    manual_review: false,
  };
}

function extractGroupSize(aboutText) {
  const t = clean(aboutText);
  let m;
  m = t.match(/(?:group size|members?)\s*[:\-]?\s*([0-9][0-9,]*)/i);
  if (m) return toInt(m[1]);
  m = t.match(/([0-9]+(?:\.[0-9]+)?)\s*[kK]\s*members?/i);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = t.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:\u4e07|\u842c)\s*(?:\u6210\u5458|\u4f4d\u6210\u5458)/i);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = t.match(/([0-9][0-9,]*)\s*(?:\u6210\u5458|\u4f4d\u6210\u5458)/i);
  if (m) return toInt(m[1]);
  return '';
}

function extractTodayPosts(aboutText) {
  const t = clean(aboutText);
  let m;
  m = t.match(/(?:today'?s?\s+new\s+posts?|new\s+posts?\s+today|posts?\s+today)\s*[:\-]?\s*([0-9][0-9,+]*)/i);
  if (m) return toInt(m[1]);
  m = t.match(/([0-9][0-9,+]*)\s*(?:new\s+posts?\s+today|posts?\s+today)/i);
  if (m) return toInt(m[1]);
  m = t.match(/(?:\u4eca\u65e5\u65b0\u5e16|\u4eca\u5929\u65b0\u5e16)\s*[:\uff1a\-]?\s*([0-9][0-9,+]*)/i);
  if (m) return toInt(m[1]);
  return '';
}

function extractWeekNewFans(aboutText) {
  const t = clean(aboutText);
  let m;
  m = t.match(/(?:new members?|new fans?)\s*(?:in|for)\s*(?:the\s*)?last week\s*[:\-]?\s*\+?\s*([0-9][0-9,+]*)/i);
  if (m) return toInt(m[1]);
  m = t.match(/last week\s*[:\-]?\s*\+?\s*([0-9][0-9,+]*)\s*(?:new members?|new fans?)/i);
  if (m) return toInt(m[1]);
  m = t.match(/(?:\u4e0a\u5468\u65b0\u589e\u7c89\u4e1d|\u4e0a\u5468\u65b0\u589e\u6210\u5458)\s*[:\uff1a\-]?\s*\+?\s*([0-9][0-9,+]*)/i);
  if (m) return toInt(m[1]);
  return '';
}

function extractExistedLastMonth(aboutText) {
  const t = clean(aboutText).toLowerCase();
  if (/last month.*posts?|posts?.*last month|\u4e0a\u6708.*\u53d1\u5e16/.test(t)) return 'yes';
  if (/did not exist last month|not exist last month|\u4e0a\u6708\u4e0d\u5b58\u5728/.test(t)) return 'no';
  return '';
}

function actionFromExisted(existed) {
  if (existed === 'yes') return 'update';
  if (existed === 'no') return 'add';
  return '';
}

function actionReason(todayPosts, weekNewFans, existed, threshold) {
  const bits = [];
  if (todayPosts !== '' && Number(todayPosts) >= threshold) bits.push('today_posts>=threshold');
  if (weekNewFans !== '' && Number(weekNewFans) >= threshold) bits.push('week_new_fans>=threshold');
  if (existed === 'yes') bits.push('existed_last_month=yes');
  else if (existed === 'no') bits.push('existed_last_month=no');
  else bits.push('existed_last_month=missing');
  return bits.join('; ');
}
function riskLevel(row) {
  const full = row.group_size !== '' && row.today_posts !== '' && row.week_new_fans !== '' && row.existed_last_month !== '';
  if (row.__match_type === 'exact_phrase_in_group_name' && full) return 'low';
  if (row.__match_type === 'exact_phrase_in_group_name' || row.__match_type === 'exact_phrase_in_full_text') return 'medium';
  return 'high';
}

function unavailableText(text) {
  const t = (text || '').toLowerCase();
  return /this content isn't available|content unavailable|page isn't available|page not found|this page isn't available/.test(t);
}
async function extractPageText(page) {
  return page.evaluate(() => {
    const selectors = [
      'div[role="main"]',
      '[aria-label="Group by"]',
      '[data-pagelet*="Group"]',
      '[data-pagelet*="group"]',
      '#content',
      'main',
    ];
    const chunks = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = (el?.innerText || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length >= 40) chunks.push(txt);
    }
    const bodyTxt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    if (bodyTxt) chunks.push(bodyTxt);
    const uniq = Array.from(new Set(chunks.filter(Boolean)));
    return uniq.sort((a, b) => b.length - a.length)[0] || '';
  });
}

async function settleAboutPage(page) {
  await page.waitForTimeout(2500);
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch (_e) {
    // some Facebook pages never reach full idle
  }
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(800);
}

async function fetchAboutWithRetry(page, groupUrl, maxTry = 2) {
  const cleanBase = groupUrl.replace(/\/+$/, '');
  const urls = Array.from(new Set([
    `${cleanBase}/about`,
    `${cleanBase}/about/`,
    `${cleanBase}?view=info`,
  ]));

  for (const aboutUrl of urls) {
    for (let i = 1; i <= maxTry; i++) {
      try {
        await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settleAboutPage(page);
        const currentUrl = page.url();
        if (/\/login|checkpoint|recover|two_step_verification/i.test(currentUrl)) {
          return { ok: false, text: '', reason: 'LOGIN_REQUIRED' };
        }
        const pageText = await extractPageText(page);
        if (!pageText || pageText.length < 40) continue;
        if (unavailableText(pageText)) continue;
        return { ok: true, text: pageText, reason: '' };
      } catch (_e) {
        // try next attempt/url
      }
    }
  }
  return { ok: false, text: '', reason: 'ABOUT_FETCH_FAILED' };
}

function toCsv(rows, fields) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [fields.join(',')].concat(rows.map((row) => fields.map((f) => esc(row[f])).join(','))).join('\n');
}

function buildSummary(rows) {
  const total = rows.length;
  const thRows = rows.filter((r) => r.region === 'TH');
  const vnRows = rows.filter((r) => r.region === 'VN');
  const regionCounts = {};
  const languageCounts = {};
  for (const row of rows) {
    const regionKey = row.region || 'UNMAPPED';
    const langKey = row.language_signal || 'Unknown';
    regionCounts[regionKey] = (regionCounts[regionKey] || 0) + 1;
    languageCounts[langKey] = (languageCounts[langKey] || 0) + 1;
  }
  const th = thRows.length;
  const vn = vnRows.length;
  const add = rows.filter((r) => r.action === 'add').length;
  const update = rows.filter((r) => r.action === 'update').length;
  const low = rows.filter((r) => r.risk_level === 'low').length;
  const medium = rows.filter((r) => r.risk_level === 'medium').length;
  const high = rows.filter((r) => r.risk_level === 'high').length;

  const avg = (arr, key) => {
    const vals = arr.map((r) => toInt(r[key])).filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (!vals.length) return '';
    return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  };

  return {
    total,
    regions: regionCounts,
    languages: languageCounts,
    TH: th,
    VN: vn,
    TH_pct: total ? Number(((th * 100) / total).toFixed(2)) : 0,
    VN_pct: total ? Number(((vn * 100) / total).toFixed(2)) : 0,
    add,
    update,
    risk: { low, medium, high },
    activity: {
      TH_avg_today_posts: avg(thRows, 'today_posts'),
      VN_avg_today_posts: avg(vnRows, 'today_posts'),
      TH_avg_week_new_fans: avg(thRows, 'week_new_fans'),
      VN_avg_week_new_fans: avg(vnRows, 'week_new_fans'),
    },
  };
}

function resolveCollisions(rows) {
  const byUrl = new Map();
  for (const row of rows) {
    if (!byUrl.has(row.group_url)) byUrl.set(row.group_url, []);
    byUrl.get(row.group_url).push(row);
  }

  const kept = [];
  const report = [];
  let droppedCollision = 0;

  for (const [groupUrl, arr] of byUrl.entries()) {
    if (arr.length === 1) {
      kept.push(arr[0]);
      continue;
    }

    const sorted = [...arr].sort((a, b) => (b.__match_score || 0) - (a.__match_score || 0));
    const topScore = sorted[0].__match_score || 0;
    const topRows = sorted.filter((r) => (r.__match_score || 0) === topScore);

    if (topRows.length === 1) {
      kept.push(topRows[0]);
      droppedCollision += sorted.length - 1;
      report.push({
        group_url: groupUrl,
        resolution: 'keep_highest_score',
        kept_game_name: topRows[0].game_name,
        kept_match_type: topRows[0].__match_type,
        kept_match_score: topRows[0].__match_score,
        dropped_games: sorted.slice(1).map((r) => ({ game_name: r.game_name, match_type: r.__match_type, match_score: r.__match_score })),
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
      dropped_games: sorted.map((r) => ({ game_name: r.game_name, match_type: r.__match_type, match_score: r.__match_score })),
    });
  }

  return { rows: kept, report, droppedCollision };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const indexFile = path.resolve(args.index || '');
  if (!indexFile || !fs.existsSync(indexFile)) {
    console.error('Usage: node phase2_collect_details.js --index "<phase1_index.json>" --out-csv "./result.csv"');
    process.exit(1);
  }

  const outCsv = path.resolve(args['out-csv'] || path.join(path.dirname(indexFile), 'result.csv'));
  const outSummary = path.resolve(args['out-summary'] || path.join(path.dirname(indexFile), 'summary.json'));
  const outXlsx = path.resolve(args['out-xlsx'] || path.join(path.dirname(indexFile), 'result.xlsx'));
  const outCollision = path.resolve(args['out-collision'] || path.join(path.dirname(indexFile), 'collision_report.json'));
  const outAudit = path.resolve(args['out-audit'] || path.join(path.dirname(indexFile), 'audit_stats.json'));
  const outManualReview = path.resolve(args['out-manual-review'] || path.join(path.dirname(indexFile), 'manual_review_queue.csv'));
  const threshold = Number(args.threshold || 10);
  const snapshotDate = clean(args['snapshot-date'] || '');
  const configFile = args.config ? path.resolve(args.config) : '';
  const config = configFile && fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const aliasesConfig = config.aliases && typeof config.aliases === 'object' ? config.aliases : {};
  const siblingTitlesConfig = config.sibling_titles && typeof config.sibling_titles === 'object' ? config.sibling_titles : {};
  const ipRootsConfig = config.ip_roots && typeof config.ip_roots === 'object' ? config.ip_roots : {};
  const languageToRegion = {
    ...DEFAULT_LANGUAGE_TO_REGION,
    ...(config.language_to_region && typeof config.language_to_region === 'object' ? config.language_to_region : {}),
  };
  const regionKeywords = mergeKeywordMap(DEFAULT_REGION_KEYWORDS, config.region_keywords);
  const allowedLanguageSignals = Array.isArray(config.allowed_language_signals)
    ? new Set(config.allowed_language_signals.map((x) => clean(x)).filter(Boolean))
    : null;
  const allowedRegions = Array.isArray(config.allowed_regions)
    ? new Set(config.allowed_regions.map((x) => clean(x)).filter(Boolean))
    : null;

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const gameEntries = Array.isArray(index.games) ? index.games : [];
  if (!gameEntries.length) {
    console.error('phase1_index.json does not contain any game entries.');
    process.exit(1);
  }

  const profiles = new Map();
  for (const g of gameEntries) {
    profiles.set(
      g.game_name,
      buildGameProfileV3(
        g.game_name,
        aliasesConfig[g.game_name] || [],
        siblingTitlesConfig[g.game_name] || [],
        ipRootsConfig[g.game_name] || []
      )
    );
  }

  const browser = await chromium.connectOverCDP(args.cdp || config.cdp_url || 'http://127.0.0.1:9222');
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages().find((p) => p.url().includes('facebook.com')) || (await context.newPage());

  try {
    const stagedRows = [];
    const manualReviewRows = [];
    const aboutCache = new Map();
    const stats = {
      total_candidates: 0,
      skipped_card_lt_100: 0,
      about_attempted: 0,
      about_fetches: 0,
      about_cache_hits: 0,
      about_failed: 0,
      dropped_not_relevant: 0,
      dropped_lang_region: 0,
      dropped_threshold: 0,
      dropped_collision: 0,
      manual_review_rows: 0,
      output_rows: 0,
      game_breakdown: {},
    };

    for (const g of gameEntries) {
      const gameName = g.game_name;
      const profile = profiles.get(gameName);
      const candidates = JSON.parse(fs.readFileSync(g.candidates_file, 'utf8'));

      const one = { candidates: candidates.length, staged_output: 0 };
      stats.total_candidates += candidates.length;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const cardMembers = toInt(c.card_group_size);
        if (!(typeof cardMembers === 'number' && Number.isFinite(cardMembers) && cardMembers >= 100)) {
          stats.skipped_card_lt_100++;
          continue;
        }

        stats.about_attempted++;
        const aboutCacheKey = clean(c.group_url || '').replace(/\/+$/, '').toLowerCase();
        let about = aboutCacheKey ? aboutCache.get(aboutCacheKey) : null;
        if (about) {
          stats.about_cache_hits++;
        } else {
          stats.about_fetches++;
          about = await fetchAboutWithRetry(page, c.group_url, 2);
          if (aboutCacheKey) aboutCache.set(aboutCacheKey, about);
        }
        if (!about.ok) {
          stats.about_failed++;
          continue;
        }

        const aboutText = about.text;
        const groupSizeAbout = extractGroupSize(aboutText);
        const groupSize = groupSizeAbout !== '' ? groupSizeAbout : cardMembers;
        const todayPosts = extractTodayPosts(aboutText);
        const weekNewFans = extractWeekNewFans(aboutText);
        const existed = extractExistedLastMonth(aboutText);
        const match = matchGame(profile, c.group_name, aboutText, c.snippet);
        const languageSignal = detectLanguageSignal(c.group_name, aboutText, c.snippet);
        const regionKeywordMatch = detectRegionByKeywords(c.group_name, aboutText, c.snippet, regionKeywords);
        const region = mapRegion(languageSignal, languageToRegion, regionKeywordMatch);

        const row = {
          snapshot_date: snapshotDate || config.snapshot_date || new Date().toISOString().slice(0, 10),
          region,
          game_name: gameName,
          group_name: c.group_name || '',
          group_url: c.group_url || '',
          group_id: getGroupId(c.group_url || ''),
          group_size: groupSize === '' ? '' : String(groupSize),
          today_posts: todayPosts === '' ? '' : String(todayPosts),
          week_new_fans: weekNewFans === '' ? '' : String(weekNewFans),
          existed_last_month: existed,
          is_relevant: match.matched ? 'yes' : 'no',
          language_signal: languageSignal,
          action: '',
          action_reason: '',
          risk_level: '',
          __match_score: match.score,
          __match_type: match.type,
          __matched_phrase: match.phrase || '',
          __negative_hit: match.negative_hit || '',
          __review_reason: match.review_reason || '',
          __region_source: regionKeywordMatch.source || (region ? 'language_map' : ''),
          __region_keyword_hits: (regionKeywordMatch.keyword_hits || []).map((x) => `${x.region}:${x.keyword}`).join('|'),
        };

        if (match.manual_review) {
          manualReviewRows.push({
            snapshot_date: row.snapshot_date,
            game_name: row.game_name,
            group_name: row.group_name,
            group_url: row.group_url,
            language_signal: row.language_signal,
            region: row.region,
            match_type: match.type,
            matched_phrase: match.phrase || '',
            negative_hit: match.negative_hit || '',
            review_reason: match.review_reason || '',
          });
        }

        if (row.is_relevant !== 'yes') {
          stats.dropped_not_relevant++;
          continue;
        }

        if (allowedLanguageSignals && allowedLanguageSignals.size && !allowedLanguageSignals.has(row.language_signal)) {
          stats.dropped_lang_region++;
          continue;
        }

        if (allowedRegions && allowedRegions.size && !allowedRegions.has(row.region)) {
          stats.dropped_lang_region++;
          continue;
        }

        const postsNum = toInt(row.today_posts);
        const fansNum = toInt(row.week_new_fans);
        const passPosts = typeof postsNum === 'number' && Number.isFinite(postsNum) && postsNum >= threshold;
        const passFans = typeof fansNum === 'number' && Number.isFinite(fansNum) && fansNum >= threshold;
        if (!passPosts && !passFans) {
          stats.dropped_threshold++;
          continue;
        }

        const sizeNum = toInt(row.group_size);
        if (!(typeof sizeNum === 'number' && Number.isFinite(sizeNum) && sizeNum >= 100)) continue;

        row.action = actionFromExisted(row.existed_last_month);
        row.action_reason = actionReason(row.today_posts, row.week_new_fans, row.existed_last_month, threshold);
        row.risk_level = riskLevel(row);
        stagedRows.push(row);
        one.staged_output++;

        if ((i + 1) % 20 === 0 || i === candidates.length - 1) {
          console.log(JSON.stringify({ game: gameName, processed: i + 1, total: candidates.length, staged_output: one.staged_output }));
        }
      }

      stats.game_breakdown[gameName] = one;
    }

    const resolved = resolveCollisions(stagedRows);
    stats.dropped_collision = resolved.droppedCollision;
    stats.manual_review_rows = manualReviewRows.length;

    const fields = [
      'snapshot_date',
      'region',
      'game_name',
      'group_name',
      'group_url',
      'group_id',
      'group_size',
      'today_posts',
      'week_new_fans',
      'existed_last_month',
      'is_relevant',
      'language_signal',
      'action',
      'action_reason',
      'risk_level',
    ];

    const finalRows = resolved.rows.map((row) => {
      const out = { ...row };
      delete out.__match_score;
      delete out.__match_type;
      delete out.__matched_phrase;
      delete out.__negative_hit;
      delete out.__review_reason;
      return out;
    });

    stats.output_rows = finalRows.length;

    fs.mkdirSync(path.dirname(outCsv), { recursive: true });
    fs.writeFileSync(outCsv, toCsv(finalRows, fields), 'utf8');
    fs.writeFileSync(
      outManualReview,
      toCsv(manualReviewRows, [
        'snapshot_date',
        'game_name',
        'group_name',
        'group_url',
        'language_signal',
        'region',
        'match_type',
        'matched_phrase',
        'negative_hit',
        'review_reason',
      ]),
      'utf8'
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(finalRows, { header: fields });
    XLSX.utils.book_append_sheet(wb, ws, 'detail');
    XLSX.writeFile(wb, outXlsx);

    const summary = buildSummary(finalRows);
    fs.writeFileSync(outSummary, JSON.stringify({ summary, stats }, null, 2), 'utf8');
    fs.writeFileSync(outCollision, JSON.stringify(resolved.report, null, 2), 'utf8');
    fs.writeFileSync(outAudit, JSON.stringify(stats, null, 2), 'utf8');

    console.log(JSON.stringify({
      ok: true,
      out_csv: outCsv,
      out_xlsx: outXlsx,
      out_summary: outSummary,
      out_collision: outCollision,
      out_audit: outAudit,
      out_manual_review: outManualReview,
      summary,
      stats,
    }, null, 2));
  } finally {
    await browser.close();
  }
})();
