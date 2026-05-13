const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const XLSX = require('xlsx');

let emergencyFlush = null;

function emergencyExit(reason, exitCode) {
  try {
    if (typeof emergencyFlush === 'function') emergencyFlush(reason);
  } catch (err) {
    console.error(`[phase2] emergency checkpoint failed: ${err && err.stack ? err.stack : err}`);
  }
  process.exit(exitCode);
}

process.once('SIGINT', () => emergencyExit('SIGINT', 130));
process.once('SIGTERM', () => emergencyExit('SIGTERM', 143));
process.once('uncaughtException', (err) => {
  console.error(err && err.stack ? err.stack : err);
  emergencyExit(`uncaughtException: ${err && err.message ? err.message : err}`, 1);
});
process.once('unhandledRejection', (err) => {
  console.error(err && err.stack ? err.stack : err);
  emergencyExit(`unhandledRejection: ${err && err.message ? err.message : err}`, 1);
});

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
  Vietnamese: ['vietnam', 'viet nam', 'viet', 'mua ban', 'cong dong', 'nap', 'giao luu', 'thanh vien', 'bai viet', 'nhom'],
  Chinese: ['chinese'],
  Spanish: ['espanol', 'latam', 'latham', 'latinoamerica', 'latin america', 'america latina', 'mexico', 'mexicano', 'mexicana', 'hispano', 'latino', 'comunidad', 'guias', 'tratos', 'ventas', 'compra', 'venta', 'cambio', 'intercambio', 'frutas'],
  Portuguese: ['portugues', 'brasil', 'brazil', 'comunidade', 'comprar', 'vender', 'troca', 'trocas', 'jogadores'],
  Indonesian: ['indonesia', 'indonesian', 'indo', 'jual beli', 'komunitas', 'grup', 'akun'],
  Malay: ['malaysia', 'malay', 'melayu', 'jual beli', 'komuniti'],
  Filipino: ['philippines', 'filipino', 'pinoy', 'pilipinas', 'benta', 'bili', 'tambayan'],
  Japanese: ['japan', 'japanese'],
  Korean: ['korea', 'korean'],
  French: ['francais', 'français', 'francophone', 'france', 'afrique francophone'],
  German: ['deutsch', 'german', 'deutschland'],
  Russian: ['russian', 'russia'],
  Arabic: ['arabic'],
  Turkish: ['turkish', 'turkey', 'turkiye'],
  Hindi: ['hindi', 'india'],
  English: ['english', 'global', 'international', 'worldwide'],
};

const EXTRA_LANGUAGE_KEYWORDS = {
  Vietnamese: ['chia se', 'trao doi', 'kinh nghiem'],
  Spanish: ['jugadores', 'cuentas'],
  Portuguese: ['venda', 'contas'],
  Indonesian: ['pemain', 'berbagi', 'diskusi'],
  Malay: ['kumpulan', 'akaun', 'pemain'],
  Filipino: ['grupo', 'manlalaro'],
  French: ['communaute', 'groupe', 'joueurs', 'vente', 'achat', 'echanges', 'compte', 'comptes', 'astuces', 'entraide'],
  German: ['gruppe', 'spieler', 'kaufen', 'verkaufen', 'tauschen'],
  Italian: ['italiano', 'italia', 'comunita', 'giocatori', 'vendita', 'acquisto', 'scambio'],
  Dutch: ['nederlands', 'nederland', 'belgie', 'groep', 'spelers', 'kopen', 'verkopen', 'ruilen'],
  Polish: ['polski', 'polska', 'grupa', 'gracze', 'sprzedam', 'kupie', 'wymiana'],
  Turkish: ['turkce', 'oyuncu', 'grup', 'satis', 'alis', 'hesap'],
  Lao: ['lao', 'laos'],
  Khmer: ['khmer', 'cambodia'],
  Burmese: ['burmese', 'myanmar'],
  English: ['community', 'players', 'buy', 'sell', 'trade', 'account', 'accounts', 'guide', 'tips'],
};

const LANGUAGE_STOPWORDS = {
  English: ['the', 'and', 'for', 'with', 'you', 'your', 'this', 'that', 'from', 'are', 'have', 'join', 'group', 'community', 'players', 'buy', 'sell', 'trade'],
  French: ['bonjour', 'salut', 'avec', 'pour', 'dans', 'nous', 'vous', 'les', 'des', 'une', 'est', 'sont', 'sur', 'pas', 'plus', 'groupe', 'communaute', 'joueurs', 'francophone'],
  Spanish: ['hola', 'para', 'con', 'los', 'las', 'una', 'que', 'del', 'por', 'este', 'esta', 'grupo', 'comunidad', 'jugadores', 'venta', 'compra', 'cuenta'],
  Portuguese: ['ola', 'para', 'com', 'dos', 'das', 'uma', 'que', 'por', 'este', 'esta', 'grupo', 'comunidade', 'jogadores', 'venda', 'compra', 'conta'],
  Indonesian: ['yang', 'dan', 'untuk', 'dengan', 'dari', 'ini', 'itu', 'grup', 'komunitas', 'pemain', 'jual', 'beli', 'akun'],
  Malay: ['yang', 'dan', 'untuk', 'dengan', 'dari', 'ini', 'itu', 'kumpulan', 'komuniti', 'pemain', 'jual', 'beli', 'akaun'],
  Filipino: ['ang', 'mga', 'para', 'kung', 'dito', 'natin', 'grupo', 'benta', 'bili', 'tambayan'],
  Vietnamese: ['cho', 'voi', 'cua', 'cac', 'nhom', 'thanh', 'vien', 'mua', 'ban', 'giao', 'luu', 'chia', 'se', 'kinh', 'nghiem'],
  German: ['und', 'der', 'die', 'das', 'mit', 'fur', 'von', 'gruppe', 'spieler', 'kaufen', 'verkaufen'],
  Italian: ['ciao', 'per', 'con', 'gli', 'una', 'che', 'del', 'gruppo', 'comunita', 'giocatori', 'vendita'],
  Dutch: ['voor', 'met', 'van', 'het', 'een', 'groep', 'spelers', 'kopen', 'verkopen'],
  Polish: ['dla', 'oraz', 'jest', 'grupa', 'gracze', 'kupie', 'sprzedam', 'wymiana'],
  Turkish: ['icin', 'ile', 'bir', 'oyuncu', 'grup', 'satis', 'alis', 'hesap'],
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
  Greek: /[\u0370-\u03FF]/g,
  Hebrew: /[\u0590-\u05FF]/g,
  Lao: /[\u0E80-\u0EFF]/g,
  Khmer: /[\u1780-\u17FF]/g,
  Burmese: /[\u1000-\u109F]/g,
};

const DEFAULT_LANGUAGE_TO_REGION = {
  Thai: 'TH',
  Vietnamese: 'VN',
  Indonesian: 'ID',
  Malay: 'MY',
  Filipino: 'PH',
  Lao: 'LA',
  Khmer: 'KH',
  Burmese: 'MM',
};

const LANGUAGE_REGION_AUX_ALLOWED = new Set(['Thai', 'Vietnamese', 'Indonesian', 'Malay', 'Filipino', 'Lao', 'Khmer', 'Burmese']);

const DEFAULT_REGION_KEYWORDS = {
  TH: ['th', 'thai', 'thailand'],
  VN: ['vn', 'viet nam', 'vietnam', 'việt nam'],
  PH: ['ph', 'pinoy', 'philippines', 'pilipinas'],
  ID: ['id', 'indo', 'indonesia'],
  MY: ['malaysia'],
  LA: ['laos', 'lao'],
  KH: ['cambodia', 'khmer'],
  MM: ['myanmar', 'burma', 'burmese'],
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
  CN: ['cn', 'china', '中国', '中國'],
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

function normalizedTokens(text) {
  return stripDiacritics(clean(text).toLowerCase())
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .split(/\s+/)
    .filter((x) => x.length >= 2);
}

function stopwordScore(text, words) {
  const tokens = normalizedTokens(text);
  if (!tokens.length) return 0;
  const tokenSet = new Set(tokens);
  let hits = 0;
  for (const word of words || []) {
    const normalized = stripDiacritics(clean(word).toLowerCase()).replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
    if (normalized && tokenSet.has(normalized)) hits++;
  }
  return hits;
}

function mergedLanguageKeywords(lang) {
  return [
    ...(DEFAULT_LANGUAGE_KEYWORDS[lang] || []),
    ...(EXTRA_LANGUAGE_KEYWORDS[lang] || []),
  ];
}

function detectLanguageSignal(groupName, aboutText, snippet) {
  const fullText = clean(`${groupName || ''}\n${aboutText || ''}\n${snippet || ''}`);
  const enChars = countEnglishLetters(fullText);
  const scores = {};

  for (const [lang, pattern] of Object.entries(SCRIPT_LANGUAGE_PATTERNS)) {
    scores[lang] = (scores[lang] || 0) + countPattern(fullText, pattern) * 2;
  }
  const langs = unique([
    ...Object.keys(DEFAULT_LANGUAGE_KEYWORDS),
    ...Object.keys(EXTRA_LANGUAGE_KEYWORDS),
    ...Object.keys(LANGUAGE_STOPWORDS),
  ]);
  for (const lang of langs) {
    const phrases = mergedLanguageKeywords(lang);
    scores[lang] = (scores[lang] || 0)
      + phraseCount(fullText, phrases) * 8
      + phraseCount(groupName || '', phrases) * 6
      + stopwordScore(fullText, LANGUAGE_STOPWORDS[lang] || []) * 5;
  }
  if (enChars >= 80 && Math.max(...Object.values(scores), 0) < 8) {
    scores.English = (scores.English || 0) + 6;
  }

  const ranked = Object.entries(scores)
    .filter(([, score]) => score >= 8)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'Unknown';
  if (ranked.length > 1 && ranked[0][1] < ranked[1][1] + 6) return 'Mixed';
  return ranked[0][0];
}

function looksLikeUiLine(line) {
  const t = clean(line).toLowerCase();
  if (!t) return true;
  if (t.length < 8) return true;
  if (/^\d+([,.]\d+)?\s*[km]?$/.test(t)) return true;
  if (/^(like|comment|share|send|follow|join|joined|invite|members?|posts?|photos?|videos?|files?|events?)$/i.test(t)) return true;
  if (/^(赞|评论|分享|发送|加入|已加入|邀请|成员|帖子|照片|视频|文件|活动|简介|讨论|精选|管理)$/u.test(t)) return true;
  if (/^(公開|公开|私密|小组|社群|社團|首頁|首页|通知|搜尋|搜索|建立|管理)$/u.test(t)) return true;
  if (/(facebook|messenger|meta|隐私|公開小組|公开小组|私密小组|查看更多|查看全部|发帖|写评论|回复|最相关|所有动态|管理员|版主|邀请成员|加入小组|已加入|小时前|分钟前|刚刚|昨天|今天|赞了|回应了|分享了|评论了|成员|帖子|讨论|简介|精选|照片|视频|文件|活动)/iu.test(t)) return true;
  if (/^[\p{Script=Han}\s\d,，.。:：()（）]+$/u.test(t) && !/(買|卖|賣|群|服|赛|賽|玩家|公会|公會|交易|账号|帳號|戰|战|足球|手遊|手游|攻略)/u.test(t)) return true;
  return false;
}

function languageEvidenceText(groupName, aboutLanguageText, discussionLanguageText, snippet) {
  const parts = [
    groupName || '',
    aboutLanguageText || '',
    discussionLanguageText || '',
    snippet || '',
  ];
  return parts
    .join('\n')
    .split(/\n+/)
    .map((x) => clean(x))
    .filter((x) => x && !looksLikeUiLine(x))
    .join('\n');
}

function sanitizeAboutLanguageText(aboutLanguageText) {
  const lines = clean(aboutLanguageText || '')
    .split(/\n+/)
    .map((x) => clean(x))
    .filter(Boolean)
    .filter((x) => !looksLikeUiLine(x));
  const kept = [];
  for (const line of lines) {
    const cjk = countChineseChars(line);
    const latin = countEnglishLetters(line);
    const nonCjkScript =
      countThaiChars(line) +
      countVnDiacritics(line) +
      countPattern(line, /[\u3040-\u30FF]/g) +
      countPattern(line, /[\uAC00-\uD7AF]/g) +
      countPattern(line, /[\u0400-\u04FF]/g) +
      countPattern(line, /[\u0600-\u06FF]/g) +
      countPattern(line, /[\u0900-\u097F]/g);
    // If an about line is only Chinese UI-like structure, ignore it. Real user descriptions usually contain game/social terms or another script.
    if (cjk > 0 && latin === 0 && nonCjkScript === 0) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

function detectLanguageFromGroupName(groupName) {
  const name = clean(groupName);
  const norm = ` ${stripDiacritics(name.toLowerCase()).replace(/[^\p{Letter}\p{Number}]+/gu, ' ')} `;
  if (countThaiChars(name) >= 2) return 'Thai';
  if (/[\u0600-\u06FF]/u.test(name)) return 'Arabic';
  if (/[\u0900-\u097F]/u.test(name)) return 'Hindi';
  if (/[\u0400-\u04FF]/u.test(name)) return 'Russian';
  if (/[\u3040-\u30FF]/u.test(name)) return 'Japanese';
  if (/[\uAC00-\uD7AF]/u.test(name)) return 'Korean';
  if (/[\u0E80-\u0EFF]/u.test(name)) return 'Lao';
  if (/[\u1780-\u17FF]/u.test(name)) return 'Khmer';
  if (/[\u1000-\u109F]/u.test(name)) return 'Burmese';
  if (countChineseChars(name) >= 2) return 'Chinese';
  if (countVnDiacritics(name) >= 2 || /\b(viet nam|vietnam|viet|mua ban|cong dong|cho|trao doi|quoc te|nap|giao luu)\b/i.test(norm)) return 'Vietnamese';
  if (/\b(espanol|latam|latham|latinoamerica|latin america|america latina|latino|mexico|mexicano|mexicana|comunidad|cambio|venta|comprar|vender)\b/i.test(norm)) return 'Spanish';
  if (/\b(portugues|brasil|brazil|comunidade)\b/i.test(norm)) return 'Portuguese';
  if (/\b(indonesia|indonesian|indo|jual beli|komunitas|akun)\b/i.test(norm)) return 'Indonesian';
  if (/\b(malaysia|malay|melayu|komuniti)\b/i.test(norm)) return 'Malay';
  if (/\b(philippines|filipino|pinoy|pilipinas|tambayan)\b/i.test(norm)) return 'Filipino';
  if (/\b(francais|francophone|france|afrique francophone)\b/i.test(norm)) return 'French';
  if (/\b(deutsch|deutschland|german|gruppe|spieler)\b/i.test(norm)) return 'German';
  if (/\b(italiano|italia|comunita|giocatori)\b/i.test(norm)) return 'Italian';
  if (/\b(nederlands|nederland|belgie|groep|spelers)\b/i.test(norm)) return 'Dutch';
  if (/\b(polski|polska|grupa|gracze)\b/i.test(norm)) return 'Polish';
  if (/\b(turkce|turkish|turkiye|turkey|oyuncu)\b/i.test(norm)) return 'Turkish';
  if (/\b(lao|laos)\b/i.test(norm)) return 'Lao';
  if (/\b(khmer|cambodia)\b/i.test(norm)) return 'Khmer';
  if (/\b(burmese|myanmar|burma)\b/i.test(norm)) return 'Burmese';
  return '';
}

function normalizeDetectedLanguage(detected, evidence) {
  if (detected === 'Chinese') {
    const cjk = countChineseChars(evidence);
    const latin = countEnglishLetters(evidence);
    if (cjk < 40) return latin >= 40 ? 'English' : 'Unknown';
    if (latin > 0 && cjk / (cjk + latin) < 0.25) return 'English';
  }
  return detected;
}

function detectSinglePostLanguage(postText) {
  const evidence = languageEvidenceText('', '', postText, '');
  if (!evidence) return 'Unknown';
  const detected = normalizeDetectedLanguage(detectLanguageSignal('', evidence, ''), evidence);
  if (detected && detected !== 'Unknown' && detected !== 'Mixed') return detected;

  const scriptSignals = [
    ['Thai', countThaiChars(evidence)],
    ['Vietnamese', countVnDiacritics(evidence)],
    ['Chinese', countChineseChars(evidence)],
    ['Arabic', countPattern(evidence, /[\u0600-\u06FF]/g)],
    ['Hindi', countPattern(evidence, /[\u0900-\u097F]/g)],
    ['Russian', countPattern(evidence, /[\u0400-\u04FF]/g)],
    ['Japanese', countPattern(evidence, /[\u3040-\u30FF]/g)],
    ['Korean', countPattern(evidence, /[\uAC00-\uD7AF]/g)],
    ['Lao', countPattern(evidence, /[\u0E80-\u0EFF]/g)],
    ['Khmer', countPattern(evidence, /[\u1780-\u17FF]/g)],
    ['Burmese', countPattern(evidence, /[\u1000-\u109F]/g)],
  ].filter(([, count]) => count >= 2);
  if (scriptSignals.length === 1) return scriptSignals[0][0];
  if (scriptSignals.length > 1) return 'Mixed';

  const latin = countEnglishLetters(evidence);
  if (latin >= 20) return 'English';
  return 'Unknown';
}

function detectDiscussionLanguageFromPosts(discussionLanguageText) {
  const raw = discussionLanguageText || '';
  const posts = raw
    .split(/\n---POST---\n|\n\s*\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!posts.length) return '';

  const languages = [];
  for (const post of posts) {
    const lang = detectSinglePostLanguage(post);
    if (lang && lang !== 'Unknown') languages.push(lang);
  }
  const uniqueLangs = unique(languages);
  if (uniqueLangs.length > 1) return 'Mixed';
  if (uniqueLangs.length === 1) return uniqueLangs[0];
  return '';
}

function detectLanguageSignalFromEvidence(groupName, aboutLanguageText, discussionLanguageText, snippet) {
  const discussionEvidence = languageEvidenceText('', '', discussionLanguageText, '');
  if (discussionEvidence) {
    const postLevelLanguage = detectDiscussionLanguageFromPosts(discussionLanguageText);
    if (postLevelLanguage) return postLevelLanguage;

    const discussionDetected = normalizeDetectedLanguage(detectLanguageSignal('', discussionEvidence, ''), discussionEvidence);
    if (discussionDetected && discussionDetected !== 'Unknown' && discussionDetected !== 'Mixed') {
      return discussionDetected;
    }
  }

  const groupNameSignal = detectLanguageFromGroupName(groupName);
  if (groupNameSignal) {
    if (!discussionEvidence || groupNameSignal !== 'Chinese') return groupNameSignal;
  }

  if (discussionEvidence) {
    const discussionDetected = normalizeDetectedLanguage(detectLanguageSignal(groupName || '', discussionEvidence, ''), discussionEvidence);
    if (discussionDetected && discussionDetected !== 'Unknown') return discussionDetected;
  }

  const aboutEvidence = sanitizeAboutLanguageText(aboutLanguageText);
  if (aboutEvidence) {
    const aboutDetected = normalizeDetectedLanguage(detectLanguageSignal('', aboutEvidence, ''), aboutEvidence);
    // About text is lowest priority and may contain localized Facebook structure text.
    // Never let about-only evidence create a Chinese label unless discussion/group name already proved it.
    if (aboutDetected && aboutDetected !== 'Unknown' && aboutDetected !== 'Chinese') return aboutDetected;
  }

  const fallbackEvidence = languageEvidenceText(groupName, '', '', snippet);
  const fallbackDetected = normalizeDetectedLanguage(detectLanguageSignal('', fallbackEvidence, ''), fallbackEvidence);
  return fallbackDetected || 'Unknown';
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

function detectRegionByGroupName(groupName, regionKeywords) {
  if (!regionKeywords || typeof regionKeywords !== 'object') {
    return { region: '', source: '', keyword_hits: [] };
  }

  const fullText = clean(groupName || '');
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
  if (!LANGUAGE_REGION_AUX_ALLOWED.has(languageSignal)) {
    return '';
  }
  if (languageToRegion && Object.prototype.hasOwnProperty.call(languageToRegion, languageSignal)) {
    return clean(languageToRegion[languageSignal] || '');
  }
  return defaultLanguageToRegion(languageSignal);
}

function normalizeCompact(s) {
  return stripDiacritics(clean(s))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function normalizeWords(s) {
  return stripDiacritics(clean(s))
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

function buildConfiguredTitleVariants(gameName, config) {
  const overrides = config.title_variant_overrides && typeof config.title_variant_overrides === 'object'
    ? config.title_variant_overrides
    : {};
  const override = overrides[gameName] || {};
  const explicitVariants = Array.isArray(override.search_variants) ? override.search_variants : [];
  const out = [];
  for (const item of explicitVariants) {
    if (typeof item === 'string') {
      out.push({ query: clean(item), type: 'configured_variant' });
      continue;
    }
    if (item && typeof item === 'object' && clean(item.query)) {
      out.push({
        query: clean(item.query),
        type: clean(item.type) || 'configured_variant',
        min_group_size: item.min_group_size,
        min_today_posts: item.min_today_posts,
        min_week_new_fans: item.min_week_new_fans,
      });
    }
  }
  return out.filter((x) => x.query);
}

function buildGameProfileV3(gameName, aliases, siblingTitles, ipRoots, config = {}) {
  const base = buildGameProfile(gameName, aliases);
  const siblingRawPhrases = unique((Array.isArray(siblingTitles) ? siblingTitles : []).map((s) => clean(s)).filter(Boolean));
  const siblingCompactPhrases = unique(siblingRawPhrases.map((s) => normalizeCompact(s)).filter(Boolean));
  const ipRootRawPhrases = unique(
    ((Array.isArray(ipRoots) && ipRoots.length ? ipRoots : base.strongTokens.slice(0, 1)) || [])
      .map((s) => clean(s))
      .filter(Boolean)
  );
  const ipRootCompactPhrases = unique(ipRootRawPhrases.map((s) => normalizeCompact(s)).filter(Boolean));
  const configuredTitleVariants = buildConfiguredTitleVariants(gameName, config);
  const connectorXVariants = configuredTitleVariants.filter((x) => x.type === 'connector_x');
  return {
    ...base,
    siblingRawPhrases,
    siblingCompactPhrases,
    ipRootRawPhrases,
    ipRootCompactPhrases,
    configuredTitleVariants,
    connectorXVariants,
  };
}

function phrasePresent(compactText, compactPhrases) {
  let best = '';
  for (const p of compactPhrases) {
    if (p && compactText.includes(p) && p.length > best.length) best = p;
  }
  return best;
}

function phrasePresentWords(normText, rawPhrases) {
  const padded = ` ${normalizeWords(normText)} `;
  let best = '';
  for (const phrase of rawPhrases || []) {
    const normalized = normalizeWords(phrase).trim();
    if (!normalized) continue;
    if (padded.includes(` ${normalized} `) && normalized.length > best.length) best = normalized;
  }
  return best;
}

function variantPhrasePresent(groupName, variants) {
  const normGroup = normalizeWords(groupName || '');
  const compactGroup = normalizeCompact(groupName || '');
  let best = null;
  for (const variant of variants || []) {
    const phrase = clean(variant.query);
    if (!phrase) continue;
    const norm = normalizeWords(phrase).trim();
    const compact = normalizeCompact(phrase);
    const matched = (norm && ` ${normGroup} `.includes(` ${norm} `)) || (compact && compactGroup.includes(compact));
    if (!matched) continue;
    if (!best || compact.length > normalizeCompact(best.query).length) best = variant;
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
  const exactGroupWords = phrasePresentWords(groupName || '', profile.rawPhrases);
  const compactGroupHit = phrasePresent(compactGroup, profile.compactPhrases);
  const connectorXHit = variantPhrasePresent(groupName || '', profile.connectorXVariants || []);
  const negativeGroup = phrasePresent(compactGroup, profile.siblingCompactPhrases || []);

  if (negativeGroup && (!compactGroupHit || negativeGroup.length > compactGroupHit.length)) {
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

  if (exactGroupWords) {
    return {
      matched: true,
      score: 300 + normalizeCompact(exactGroupWords).length,
      type: 'exact_phrase_in_group_name',
      phrase: exactGroupWords,
      negative_hit: '',
      review_reason: '',
      manual_review: false,
    };
  }

  if (compactGroupHit) {
    return {
      matched: true,
      score: 285 + compactGroupHit.length,
      type: 'compact_title_in_group_name',
      phrase: compactGroupHit,
      negative_hit: '',
      review_reason: '',
      manual_review: false,
    };
  }

  if (connectorXHit) {
    return {
      matched: true,
      score: 260 + normalizeCompact(connectorXHit.query).length,
      type: 'connector_x_title_in_group_name',
      phrase: connectorXHit.query,
      negative_hit: '',
      review_reason: '',
      manual_review: false,
      variant: connectorXHit,
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

function actionReason(todayPosts, weekNewFans, existed, thresholdSpec) {
  const spec = typeof thresholdSpec === 'object' && thresholdSpec
    ? thresholdSpec
    : { today_posts: Number(thresholdSpec || 10), week_new_fans: Number(thresholdSpec || 10) };
  const bits = [];
  if (todayPosts !== '' && Number(todayPosts) >= spec.today_posts) bits.push(`today_posts>=${spec.today_posts}`);
  if (weekNewFans !== '' && Number(weekNewFans) >= spec.week_new_fans) bits.push(`week_new_fans>=${spec.week_new_fans}`);
  if (existed === 'yes') bits.push('existed_last_month=yes');
  else if (existed === 'no') bits.push('existed_last_month=no');
  else bits.push('existed_last_month=missing');
  return bits.join('; ');
}

function thresholdSpecForMatch(match, globalThreshold) {
  if (match?.type === 'connector_x_title_in_group_name') {
    const variant = match.variant || {};
    return {
      group_size: Number(variant.min_group_size || 1000),
      today_posts: Math.max(Number(globalThreshold || 10), Number(variant.min_today_posts || 20)),
      week_new_fans: Math.max(Number(globalThreshold || 10), Number(variant.min_week_new_fans || 50)),
      source: 'connector_x_variant_threshold',
    };
  }
  return {
    group_size: 100,
    today_posts: Number(globalThreshold || 10),
    week_new_fans: Number(globalThreshold || 10),
    source: 'global_threshold',
  };
}

function riskLevel(row) {
  const full = row.group_size !== '' && row.today_posts !== '' && row.week_new_fans !== '' && row.existed_last_month !== '';
  if (row.__match_type === 'exact_phrase_in_group_name' && full) return 'low';
  if (row.__match_type === 'compact_title_in_group_name' && full) return 'low';
  if (row.__match_type === 'connector_x_title_in_group_name') return 'medium';
  if (row.__match_type === 'exact_phrase_in_group_name' || row.__match_type === 'compact_title_in_group_name' || row.__match_type === 'exact_phrase_in_full_text') return 'medium';
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


async function extractGroupNameFromPage(page) {
  return page.evaluate(() => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const candidates = [];
    for (const sel of ['div[role="main"] h1', 'h1', '[role="main"] span[dir="auto"]']) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const txt = normalize(el.innerText || el.textContent || '');
        if (txt && txt.length >= 2 && txt.length <= 180) candidates.push(txt);
      }
    }
    const title = normalize(document.title || '').replace(/\s*\|\s*Facebook\s*$/i, '').replace(/\s*\|\s*Meta\s*$/i, '');
    if (title && title.length <= 180) candidates.push(title);
    const seen = new Set();
    for (const c of candidates) {
      const low = c.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      if (/^(facebook|groups|about|discussion|home)$/i.test(c)) continue;
      return c;
    }
    return '';
  });
}

async function extractLanguagePageText(page) {
  return page.evaluate(() => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const uiExact = new Set([
      'like', 'comment', 'share', 'send', 'follow', 'join', 'joined', 'invite',
      'members', 'posts', 'photos', 'videos', 'files', 'events',
      '赞', '评论', '分享', '发送', '关注', '加入', '已加入', '邀请', '成员', '帖子', '照片', '视频', '文件', '活动', '简介', '讨论', '精选', '管理',
    ]);
    const uiContains = /(facebook|messenger|meta|隐私|公開小組|公开小组|私密小组|查看更多|查看全部|发帖|写评论|回复|最相关|所有动态|管理员|版主|邀请成员|加入小组|已加入|小时前|分钟前|刚刚|昨天|今天|赞了|回应了|分享了|评论了|成员|帖子|讨论|简介|精选|照片|视频|文件|活动)/iu;
    const chunks = [];
    const selectors = [
      'div[dir="auto"]',
      'span[dir="auto"]',
      '[role="article"] div[dir="auto"]',
      '[role="article"] span[dir="auto"]',
    ];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const txt = normalize(el.innerText || el.textContent || '');
        const low = txt.toLowerCase();
        if (!txt || txt.length < 8) continue;
        if (txt.length > 1200) continue;
        if (uiExact.has(low) || uiExact.has(txt)) continue;
        if (uiContains.test(txt)) continue;
        if (/^\d+([,.]\d+)?\s*[km]?$/.test(low)) continue;
        if (/^[\p{Script=Han}\s\d,，.。:：()（）]+$/u.test(txt) && !/(買|卖|賣|群|服|赛|賽|玩家|公会|公會|交易|账号|帳號|戰|战|足球|手遊|手游|攻略)/u.test(txt)) continue;
        chunks.push(txt);
      }
    }
    return Array.from(new Set(chunks)).slice(0, 80).join('\n');
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
        const languageText = await extractLanguagePageText(page);
        const pageGroupName = await extractGroupNameFromPage(page);
        if (!pageText || pageText.length < 40) continue;
        if (unavailableText(pageText)) continue;
        return { ok: true, text: pageText, language_text: languageText, group_name: pageGroupName, reason: '' };
      } catch (_e) {
        // try next attempt/url
      }
    }
  }
  return { ok: false, text: '', reason: 'ABOUT_FETCH_FAILED' };
}

async function extractDiscussionPostTexts(page, limit = 5) {
  return page.evaluate((limit) => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const uiExact = new Set([
      'like', 'comment', 'share', 'send', 'follow', 'join', 'joined', 'invite',
      'members', 'posts', 'photos', 'videos', 'files', 'events',
      '赞', '评论', '分享', '发送', '关注', '加入', '已加入', '邀请', '成员', '帖子', '照片', '视频', '文件', '活动', '简介', '讨论', '精选', '管理',
    ]);
    const uiContains = /(facebook|messenger|meta|隐私|公開小組|公开小组|私密小组|查看更多|查看全部|发帖|写评论|回复|最相关|所有动态|管理员|版主|邀请成员|加入小组|已加入|小时前|分钟前|刚刚|昨天|今天|赞了|回应了|分享了|评论了|成员|帖子|讨论|简介|精选|照片|视频|文件|活动)/iu;
    const cleanLine = (txt) => {
      const t = normalize(txt);
      const low = t.toLowerCase();
      if (!t || t.length < 8) return '';
      if (t.length > 800) return '';
      if (uiExact.has(low) || uiExact.has(t)) return '';
      if (uiContains.test(t)) return '';
      if (/^\d+([,.]\d+)?\s*[km]?$/.test(low)) return '';
      if (/^[\p{Script=Han}\s\d,，.。:：()（）]+$/u.test(t) && !/(買|卖|賣|群|服|赛|賽|玩家|公会|公會|交易|账号|帳號|戰|战|足球|手遊|手游|攻略)/u.test(t)) return '';
      return t;
    };

    const posts = [];
    const seen = new Set();
    for (const article of Array.from(document.querySelectorAll('[role="article"]'))) {
      const lines = [];
      for (const el of Array.from(article.querySelectorAll('div[dir="auto"], span[dir="auto"]'))) {
        const line = cleanLine(el.innerText || el.textContent || '');
        if (line) lines.push(line);
      }
      const text = Array.from(new Set(lines)).join('\n');
      if (text.length < 12) continue;
      const key = text.slice(0, 160);
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push(text);
      if (posts.length >= limit) break;
    }
    return posts;
  }, limit);
}

async function settleDiscussionPage(page) {
  await page.waitForTimeout(2000);
  try {
    await page.waitForLoadState('networkidle', { timeout: 4000 });
  } catch (_e) {
    // Facebook feeds often keep long-polling open.
  }
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(900);
  }
}

async function fetchDiscussionLanguageSample(page, groupUrl) {
  const cleanBase = clean(groupUrl || '').replace(/\/+$/, '');
  if (!cleanBase) return { ok: false, text: '', reason: 'MISSING_GROUP_URL' };
  try {
    await page.goto(cleanBase, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settleDiscussionPage(page);
    const currentUrl = page.url();
    if (/\/login|checkpoint|recover|two_step_verification/i.test(currentUrl)) {
      return { ok: false, text: '', reason: 'LOGIN_REQUIRED' };
    }
    const postTexts = await extractDiscussionPostTexts(page, 5);
    const languageText = Array.isArray(postTexts) ? postTexts.join('\n---POST---\n') : '';
    if (!languageText) {
      return { ok: false, text: '', post_count: 0, reason: 'NO_DISCUSSION_POST_TEXT' };
    }
    return { ok: true, text: languageText, post_count: postTexts.length, reason: '' };
  } catch (_e) {
    return { ok: false, text: '', reason: 'DISCUSSION_FETCH_FAILED' };
  }
}

function normalizeSnapshotDate(value, fallback) {
  const raw = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('/');
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return clean(fallback) || new Date().toISOString().slice(0, 10);
}

function buildDetailSheet(rows, fields, formulaFields) {
  const aoa = [fields];
  rows.forEach((row, idx) => {
    const excelRow = idx + 2;
    aoa.push(fields.map((field) => {
      if (field === formulaFields.activeIndex) {
        return '';
      }
      if (field === formulaFields.growthRate) {
        return '';
      }
      if (field === 'snapshot_date' || field === 'group_id') {
        return row[field] === undefined || row[field] === null ? '' : String(row[field]);
      }
      return row[field] ?? '';
    }));
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((row, idx) => {
    const excelRow = idx + 2;
    const groupSize = Number(row.group_size) || 0;
    const todayPosts = Number(row.today_posts) || 0;
    const weekNewFans = Number(row.week_new_fans) || 0;
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
    if (ws[`A${excelRow}`]) {
      ws[`A${excelRow}`].t = 's';
      ws[`A${excelRow}`].z = '@';
    }
    if (ws[`G${excelRow}`]) {
      ws[`G${excelRow}`].t = 's';
      ws[`G${excelRow}`].z = '@';
    }
  });
  ws['!cols'] = [
    { wch: 12, z: '@' },
    { wch: 10 },
    { wch: 14 },
    { wch: 26 },
    { wch: 46 },
    { wch: 48 },
    { wch: 22, z: '@' },
  ];
  return ws;
}

function buildPlainSheet(rows, fields) {
  const aoa = [fields].concat(rows.map((row) => fields.map((field) => {
    if (field === 'snapshot_date' || field === 'group_id') {
      return row[field] === undefined || row[field] === null ? '' : String(row[field]);
    }
    return row[field] ?? '';
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((row, idx) => {
    const excelRow = idx + 2;
    const dateCol = fields.indexOf('snapshot_date');
    const groupIdCol = fields.indexOf('group_id');
    for (const colIdx of [dateCol, groupIdCol]) {
      if (colIdx < 0) continue;
      const ref = XLSX.utils.encode_cell({ r: excelRow - 1, c: colIdx });
      if (ws[ref]) {
        ws[ref].t = 's';
        ws[ref].z = '@';
      }
    }
  });
  return ws;
}

function renameOverwriting(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (fs.existsSync(dest)) {
      try { fs.unlinkSync(dest); } catch (_e) { /* ignore */ }
    }
    fs.renameSync(src, dest);
  }
}

function atomicWriteText(file, content, encoding = 'utf8') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, encoding);
  renameOverwriting(tmp, file);
}

function writeJsonAtomic(file, obj) {
  atomicWriteText(file, JSON.stringify(obj, null, 2), 'utf8');
}

function writeWorkbookAtomic(file, wb) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp.xlsx`);
  try {
    XLSX.writeFile(wb, tmp);
    renameOverwriting(tmp, file);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
    throw err;
  }
}

function writePlainXlsx(file, rows, fields, sheetName = 'verified_partial') {
  const wb = XLSX.utils.book_new();
  const ws = buildPlainSheet(rows, fields);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  writeWorkbookAtomic(file, wb);
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

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const indexFile = path.resolve(args.index || '');
  if (!indexFile || !fs.existsSync(indexFile)) {
    console.error('Usage: node phase2_collect_details.js --index "<phase1_index.json>" --out-xlsx "./result.xlsx"');
    process.exit(1);
  }

  const outSummary = path.resolve(args['out-summary'] || path.join(path.dirname(indexFile), 'summary.json'));
  const outXlsx = path.resolve(args['out-xlsx'] || path.join(path.dirname(indexFile), 'result.xlsx'));
  const outCollision = path.resolve(args['out-collision'] || path.join(path.dirname(indexFile), 'collision_report.json'));
  const outAudit = path.resolve(args['out-audit'] || path.join(path.dirname(indexFile), 'audit_stats.json'));
  const outDebugRows = path.resolve(args['out-debug-rows'] || path.join(path.dirname(indexFile), 'debug_rows.json'));
  const snapshotDate = clean(args['snapshot-date'] || '');
  const configFile = args.config ? path.resolve(args.config) : '';
  const config = configFile && fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const checkpointEvery = Math.max(1, Number(args['checkpoint-every'] || config.checkpoint_every || 1));
  const checkpointEveryCandidate = Math.max(1, Number(args['checkpoint-every-candidate'] || args['checkpoint-every-candidates'] || config.checkpoint_every_candidate || config.checkpoint_every_candidates || 1));
  const outPartialXlsx = path.resolve(args['out-partial-xlsx'] || path.join(path.dirname(indexFile), 'partial_verified_rows.xlsx'));
  const outCheckpoint = path.resolve(args['out-checkpoint'] || path.join(path.dirname(indexFile), 'phase2_autosave_state.json'));
  const outPartialSummary = path.resolve(args['out-partial-summary'] || path.join(path.dirname(indexFile), 'phase2_autosave_summary.json'));
  const outProgress = path.resolve(args['out-progress'] || path.join(path.dirname(indexFile), 'phase2_progress.json'));
  const outCheckpointError = path.resolve(args['out-checkpoint-error'] || path.join(path.dirname(indexFile), 'phase2_autosave_last_error.txt'));
  const threshold = Number(args.threshold || config.threshold || 10);
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

  const allGameNames = gameEntries.map((g) => clean(g.game_name)).filter(Boolean);
  const profiles = new Map();
  for (const g of gameEntries) {
    const automaticSiblingTitles = allGameNames.filter((name) => name && name !== g.game_name);
    const configuredSiblings = siblingTitlesConfig[g.game_name] || [];
    profiles.set(
      g.game_name,
      buildGameProfileV3(
        g.game_name,
        aliasesConfig[g.game_name] || [],
        unique([...(Array.isArray(configuredSiblings) ? configuredSiblings : []), ...automaticSiblingTitles]),
        ipRootsConfig[g.game_name] || [],
        config
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
    const discussionLanguageCache = new Map();
    const stats = {
      total_candidates: 0,
      skipped_card_lt_100: 0,
      about_attempted: 0,
      about_fetches: 0,
      about_cache_hits: 0,
      about_failed: 0,
      discussion_language_attempted: 0,
      discussion_language_fetches: 0,
      discussion_language_cache_hits: 0,
      discussion_language_failed: 0,
      dropped_not_relevant: 0,
      dropped_lang_region: 0,
      dropped_threshold: 0,
      dropped_collision: 0,
      manual_review_rows: 0,
      output_rows: 0,
      game_breakdown: {},
    };
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
    let currentGameName = '';
    let currentGameIndex = -1;
    let currentCandidateIndex = -1;
    let currentCandidateTotal = 0;
    let totalProcessedCandidates = 0;
    let lastCandidateStatus = '';
    let lastCheckpointAt = '';
    let currentGameBreakdown = null;

    const makePartialRows = () => {
      const outputSnapshotDate = normalizeSnapshotDate(snapshotDate || config.snapshot_date, new Date().toISOString().slice(0, 10));
      return stagedRows.map((row) => ({
        ...row,
        snapshot_date: outputSnapshotDate,
        group_id: String(row.group_id || ''),
        language: row.language_signal || '',
        [formulaFields.activeIndex]: '',
        [formulaFields.growthRate]: '',
      }));
    };

    const writePartialCheckpoint = (meta = {}, options = {}) => {
      const now = new Date().toISOString();
      lastCheckpointAt = now;
      const shouldWriteXlsx = Boolean(options.writeXlsx);
      const shouldWriteFullState = Boolean(options.writeFullState || shouldWriteXlsx);
      const partialRows = shouldWriteXlsx ? makePartialRows() : [];
      const progress = {
        current_game_name: currentGameName,
        current_game_index: currentGameIndex,
        total_games: gameEntries.length,
        current_candidate_index: currentCandidateIndex,
        current_candidate_total: currentCandidateTotal,
        total_processed_candidates: totalProcessedCandidates,
        staged_rows: stagedRows.length,
        manual_review_rows: manualReviewRows.length,
        last_candidate_status: lastCandidateStatus,
        last_checkpoint_at: lastCheckpointAt,
        current_game_breakdown: currentGameBreakdown,
        autosave_mode: 'progress_json_every_candidate_xlsx_on_accepted_row',
        partial_xlsx_rows_saved: stagedRows.length,
        ...meta,
      };

      // Tiny progress file: written for every candidate. This is the file to watch during long phase-2 runs.
      writeJsonAtomic(outProgress, {
        checkpoint_kind: 'facebook_group_monitor_phase2_progress',
        checkpoint_version: 3,
        updated_at: now,
        index_file: indexFile,
        run_dir: path.dirname(indexFile),
        progress,
        outputs: {
          progress: outProgress,
          partial_xlsx: outPartialXlsx,
          recoverable_state: outCheckpoint,
          final_xlsx: outXlsx,
          summary: outSummary,
          collision: outCollision,
          audit: outAudit,
          debug_rows: outDebugRows,
        },
      });

      // Compatibility summary: also small enough to refresh every candidate.
      writeJsonAtomic(outPartialSummary, {
        partial: true,
        updated_at: now,
        progress,
        summary: buildSummary(stagedRows),
        stats,
      });

      // Full recovery state is much larger because it contains accepted rows and manual-review rows.
      // Write it only at accepted-row / game-boundary / emergency checkpoints, not for every rejected candidate.
      if (shouldWriteFullState) {
        const checkpoint = {
          checkpoint_version: 3,
          checkpoint_kind: 'facebook_group_monitor_phase2_autosave',
          autosave_mode: 'progress_json_every_candidate_xlsx_on_accepted_row',
          finalized: false,
          updated_at: now,
          index_file: indexFile,
          run_dir: path.dirname(indexFile),
          outputs: {
            progress: outProgress,
            partial_xlsx: outPartialXlsx,
            final_xlsx: outXlsx,
            summary: outSummary,
            collision: outCollision,
            audit: outAudit,
            debug_rows: outDebugRows,
          },
          progress,
          stats,
          staged_rows: stagedRows,
          manual_review_rows: manualReviewRows,
        };
        writeJsonAtomic(outCheckpoint, checkpoint);
      }

      if (shouldWriteXlsx) {
        try {
          // The workbook is saved immediately when a row passes all filters. Rejected candidates only touch JSON.
          writePlainXlsx(outPartialXlsx, partialRows, fields);
        } catch (err) {
          // If the workbook is open in Excel, keep JSON autosave intact and record the workbook write failure.
          atomicWriteText(outCheckpointError, `[${now}] failed to write ${outPartialXlsx}\n${err && err.stack ? err.stack : err}\n`, 'utf8');
        }
      }
    };

    emergencyFlush = (reason) => {
      writePartialCheckpoint({ stage: 'emergency_flush', reason }, { writeXlsx: true, writeFullState: true });
    };

    // Create the partial workbook immediately with headers, then keep it updated only when accepted rows appear.
    writePartialCheckpoint({ stage: 'phase2_started' }, { writeXlsx: true, writeFullState: true });

    for (let gameIdx = 0; gameIdx < gameEntries.length; gameIdx++) {
      const g = gameEntries[gameIdx];
      const gameName = g.game_name;
      currentGameName = gameName;
      currentGameIndex = gameIdx + 1;
      const profile = profiles.get(gameName);
      const candidates = JSON.parse(fs.readFileSync(g.candidates_file, 'utf8'));
      currentCandidateTotal = candidates.length;
      currentCandidateIndex = 0;

      const one = { candidates: candidates.length, staged_output: 0, processed: 0 };
      currentGameBreakdown = one;
      stats.total_candidates += candidates.length;
      writePartialCheckpoint({ stage: 'game_started' }, { writeFullState: true });

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        currentCandidateIndex = i + 1;
        let candidateCheckpointWritten = false;
        const markCandidateCheckpoint = (status, extra = {}) => {
          if (!candidateCheckpointWritten) {
            totalProcessedCandidates++;
            one.processed++;
            candidateCheckpointWritten = true;
          }
          lastCandidateStatus = status;
          if (totalProcessedCandidates % checkpointEveryCandidate === 0 || status === 'accepted') {
            writePartialCheckpoint({
              stage: 'candidate_processed',
              status,
              current_group_url: c.group_url || '',
              current_group_name: c.group_name || '',
              ...extra,
            }, {
              writeXlsx: status === 'accepted',
              writeFullState: status === 'accepted',
            });
          }
        };
        const cardMembers = toInt(c.card_group_size);
        if (!(typeof cardMembers === 'number' && Number.isFinite(cardMembers) && cardMembers >= 100)) {
          stats.skipped_card_lt_100++;
          markCandidateCheckpoint('skipped_card_lt_100');
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
          markCandidateCheckpoint('about_failed', { about_reason: about.reason || '' });
          continue;
        }

        const aboutText = about.text;
        const aboutLanguageText = about.language_text || '';
        const candidateGroupName = clean(c.group_name || about.group_name || '');
        const groupSizeAbout = extractGroupSize(aboutText);
        const groupSize = groupSizeAbout !== '' ? groupSizeAbout : cardMembers;
        const todayPosts = extractTodayPosts(aboutText);
        const weekNewFans = extractWeekNewFans(aboutText);
        const existed = extractExistedLastMonth(aboutText);
        const match = matchGame(profile, candidateGroupName, aboutText, c.snippet);
        const thresholdSpec = thresholdSpecForMatch(match, threshold);
        let languageSignal = detectLanguageSignalFromEvidence(candidateGroupName, aboutLanguageText, '', '');
        const regionKeywordMatch = detectRegionByGroupName(candidateGroupName, regionKeywords);
        let region = mapRegion(languageSignal, languageToRegion, regionKeywordMatch);

        const row = {
          snapshot_date: normalizeSnapshotDate(snapshotDate || config.snapshot_date, new Date().toISOString().slice(0, 10)),
          region,
          game_name: gameName,
          group_name: candidateGroupName,
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
          __source_query: c.source_query || (Array.isArray(c.source_queries) ? c.source_queries.join('|') : ''),
          __source_queries: Array.isArray(c.source_queries) ? c.source_queries.join('|') : (c.source_query || ''),
          __query_variant_type: c.query_variant_type || (Array.isArray(c.query_variant_types) ? c.query_variant_types.join('|') : ''),
          __query_variant_types: Array.isArray(c.query_variant_types) ? c.query_variant_types.join('|') : (c.query_variant_type || ''),
          __source_is_seed_url: c.source_is_seed_url ? 'yes' : 'no',
          __variant_threshold_applied: `${thresholdSpec.source}:group_size>=${thresholdSpec.group_size};today_posts>=${thresholdSpec.today_posts};week_new_fans>=${thresholdSpec.week_new_fans}`,
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
            source_query: row.__source_query,
            query_variant_type: row.__query_variant_type,
            source_is_seed_url: row.__source_is_seed_url,
            variant_threshold_applied: row.__variant_threshold_applied,
          });
        }

        if (row.is_relevant !== 'yes') {
          stats.dropped_not_relevant++;
          markCandidateCheckpoint('dropped_not_relevant', { match_type: match.type || '', match_score: match.score || 0 });
          continue;
        }

        const postsNum = toInt(row.today_posts);
        const fansNum = toInt(row.week_new_fans);
        const sizeNum = toInt(row.group_size);
        if (!(typeof sizeNum === 'number' && Number.isFinite(sizeNum) && sizeNum >= thresholdSpec.group_size)) {
          stats.dropped_threshold++;
          markCandidateCheckpoint('dropped_threshold_group_size');
          continue;
        }
        const passPosts = typeof postsNum === 'number' && Number.isFinite(postsNum) && postsNum >= thresholdSpec.today_posts;
        const passFans = typeof fansNum === 'number' && Number.isFinite(fansNum) && fansNum >= thresholdSpec.week_new_fans;
        if (!passPosts && !passFans) {
          stats.dropped_threshold++;
          markCandidateCheckpoint('dropped_threshold_activity');
          continue;
        }

        stats.discussion_language_attempted++;
        let discussionLanguage = aboutCacheKey ? discussionLanguageCache.get(aboutCacheKey) : null;
        if (discussionLanguage) {
          stats.discussion_language_cache_hits++;
        } else {
          stats.discussion_language_fetches++;
          discussionLanguage = await fetchDiscussionLanguageSample(page, c.group_url);
          if (aboutCacheKey) discussionLanguageCache.set(aboutCacheKey, discussionLanguage);
        }
        if (!discussionLanguage.ok) {
          stats.discussion_language_failed++;
        }
        languageSignal = detectLanguageSignalFromEvidence(
          candidateGroupName,
          aboutLanguageText,
          discussionLanguage.ok ? discussionLanguage.text : '',
          ''
        );
        region = mapRegion(languageSignal, languageToRegion, regionKeywordMatch);
        row.language_signal = languageSignal;
        row.region = region;
        row.__region_source = regionKeywordMatch.source || (region ? 'language_map' : '');

        if (allowedLanguageSignals && allowedLanguageSignals.size && !allowedLanguageSignals.has(row.language_signal)) {
          stats.dropped_lang_region++;
          markCandidateCheckpoint('dropped_language_filter', { language_signal: row.language_signal || '' });
          continue;
        }

        if (allowedRegions && allowedRegions.size && !allowedRegions.has(row.region)) {
          stats.dropped_lang_region++;
          markCandidateCheckpoint('dropped_region_filter', { region: row.region || '' });
          continue;
        }

        row.action = actionFromExisted(row.existed_last_month);
        row.action_reason = actionReason(row.today_posts, row.week_new_fans, row.existed_last_month, thresholdSpec);
        row.risk_level = riskLevel(row);
        stagedRows.push(row);
        one.staged_output++;
        markCandidateCheckpoint('accepted', { staged_output: one.staged_output });
        if (checkpointEvery > 1 && stagedRows.length % checkpointEvery === 0) {
          writePartialCheckpoint({ stage: 'accepted_row_checkpoint' }, { writeFullState: true });
        }

        if ((i + 1) % 20 === 0 || i === candidates.length - 1) {
          console.log(JSON.stringify({ game: gameName, processed: i + 1, total: candidates.length, staged_output: one.staged_output }));
        }
      }

      stats.game_breakdown[gameName] = one;
      writePartialCheckpoint({ stage: 'game_finished' }, { writeFullState: true });
    }

    const resolved = resolveCollisions(stagedRows);
    writePartialCheckpoint({ stage: 'before_final_write' }, { writeFullState: true });
    stats.dropped_collision = resolved.droppedCollision;
    stats.manual_review_rows = manualReviewRows.length;

    const outputSnapshotDate = normalizeSnapshotDate(snapshotDate || config.snapshot_date, new Date().toISOString().slice(0, 10));
    const debugRows = resolved.rows.map((row) => ({ ...row, snapshot_date: outputSnapshotDate }));
    const finalRows = resolved.rows.map((row, idx) => {
      const out = { ...row };
      const excelRow = idx + 2;
      out.snapshot_date = outputSnapshotDate;
      out.group_id = String(row.group_id || '');
      out.language = row.language_signal || '';
      out[formulaFields.activeIndex] = `=IFERROR(I${excelRow}/H${excelRow},"")`;
      out[formulaFields.growthRate] = `=IFERROR(J${excelRow}/(H${excelRow}-J${excelRow}),"")`;
      delete out.__match_score;
      delete out.__match_type;
      delete out.__matched_phrase;
      delete out.__negative_hit;
      delete out.__review_reason;
      return out;
    });

    stats.output_rows = finalRows.length;

    const wb = XLSX.utils.book_new();
    const ws = buildDetailSheet(finalRows, fields, formulaFields);
    XLSX.utils.book_append_sheet(wb, ws, 'detail');
    XLSX.utils.book_append_sheet(
      wb,
      buildPlainSheet(manualReviewRows, [
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
        'source_query',
        'query_variant_type',
        'source_is_seed_url',
        'variant_threshold_applied',
      ]),
      'manual_review'
    );
    writeWorkbookAtomic(outXlsx, wb);

    const summary = buildSummary(finalRows);
    stats.output_rows = finalRows.length;
    const finalCheckpoint = fs.existsSync(outCheckpoint) ? JSON.parse(fs.readFileSync(outCheckpoint, 'utf8')) : {};
    finalCheckpoint.finalized = true;
    finalCheckpoint.finalized_at = new Date().toISOString();
    finalCheckpoint.summary = summary;
    finalCheckpoint.progress = {
      ...(finalCheckpoint.progress || {}),
      stage: 'finalized',
      output_rows: finalRows.length,
      dropped_collision: resolved.droppedCollision,
    };
    writeJsonAtomic(outCheckpoint, finalCheckpoint);
    writeJsonAtomic(outProgress, {
      checkpoint_kind: 'facebook_group_monitor_phase2_progress',
      checkpoint_version: 3,
      finalized: true,
      finalized_at: finalCheckpoint.finalized_at,
      index_file: indexFile,
      run_dir: path.dirname(indexFile),
      progress: finalCheckpoint.progress,
      summary,
      stats,
    });
    writeJsonAtomic(outSummary, { summary, stats });
    writeJsonAtomic(outCollision, resolved.report);
    writeJsonAtomic(outAudit, stats);
    writeJsonAtomic(outDebugRows, debugRows);

    console.log(JSON.stringify({
      ok: true,
      out_xlsx: outXlsx,
      out_summary: outSummary,
      out_collision: outCollision,
      out_audit: outAudit,
      out_debug_rows: outDebugRows,
      summary,
      stats,
    }, null, 2));
  } finally {
    emergencyFlush = null;
    await browser.close();
  }
})();
