const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const XLSX = require('xlsx');

const runDir = path.resolve('runs/pokemon_go_phase2_20260709_000000');
const inputXlsx = path.join(runDir, 'fb_monitoring_filtered.xlsx');
const outputXlsx = path.join(runDir, 'fb_monitoring_filtered_geonames_filled.xlsx');
const auditFile = path.join(runDir, 'geonames_region_fill_audit.json');
const cacheFile = path.join(runDir, 'geonames_region_fill_cache.json');
const backupXlsx = path.join(runDir, `fb_monitoring_filtered.before_geonames_fill.${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.xlsx`);

const endpoint = 'http://api.geonames.org/searchJSON';
const rateLimitMs = 1200;
const timeoutMs = 8000;
const maxRows = 5;
const minConfidence = 0.75;

const regionOutputMap = {
  US: 'North America', CA: 'North America', GL: 'North America',
  MX: 'LATAM', AR: 'LATAM', CL: 'LATAM', CO: 'LATAM', PE: 'LATAM', UY: 'LATAM', PY: 'LATAM', BO: 'LATAM', EC: 'LATAM', VE: 'LATAM', CR: 'LATAM', PA: 'LATAM', GT: 'LATAM', HN: 'LATAM', SV: 'LATAM', NI: 'LATAM', BZ: 'LATAM', CU: 'LATAM', DO: 'LATAM', HT: 'LATAM', JM: 'LATAM', TT: 'LATAM', PR: 'LATAM',
  BR: 'BR',
  GB: 'EUR', UK: 'EUR', IE: 'EUR', ES: 'EUR', PT: 'EUR', SE: 'EUR', NO: 'EUR', FI: 'EUR', DK: 'EUR', IS: 'EUR', BE: 'EUR', CH: 'EUR', AT: 'EUR', CZ: 'EUR', SK: 'EUR', HU: 'EUR', RO: 'EUR', BG: 'EUR', GR: 'EUR', UA: 'EUR', BY: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', SI: 'EUR', HR: 'EUR', RS: 'EUR', BA: 'EUR', ME: 'EUR', AL: 'EUR', XK: 'EUR', MK: 'EUR', MD: 'EUR', MT: 'EUR', GE: 'EUR', AM: 'EUR', AZ: 'EUR', CY: 'EUR',
  DE: 'DE', FR: 'FR', IT: 'IT', NL: 'NL', PL: 'PL', RU: 'RU', TR: 'TR',
  CN: 'CN', HK: 'HK', MO: 'MO', TW: 'TW', JP: 'JP', KR: 'KR', KP: 'KP', MN: 'MN',
  TH: 'TH', VN: 'VN', PH: 'PH', ID: 'ID', MY: 'MY', SG: 'SG', BN: 'SEA', LA: 'LA', KH: 'KH', MM: 'MM', TL: 'SEA',
  IN: 'South Asia', PK: 'South Asia', BD: 'South Asia', LK: 'South Asia', NP: 'South Asia', BT: 'South Asia', MV: 'South Asia', AF: 'South Asia',
  SA: 'Middle East', AE: 'Middle East', QA: 'Middle East', KW: 'Middle East', BH: 'Middle East', OM: 'Middle East', YE: 'Middle East', IQ: 'Middle East', IR: 'Middle East', IL: 'Middle East', JO: 'Middle East', LB: 'Middle East', SY: 'Middle East', PS: 'Middle East', EG: 'Middle East',
  KZ: 'Central Asia', KG: 'Central Asia', TJ: 'Central Asia', TM: 'Central Asia', UZ: 'Central Asia',
  AU: 'Oceania', NZ: 'Oceania', PG: 'Oceania', FJ: 'Oceania', GU: 'Oceania', NC: 'Oceania', PF: 'Oceania',
};

const africaCodes = new Set(['ZA', 'NG', 'KE', 'GH', 'ET', 'TZ', 'UG', 'RW', 'BI', 'SO', 'DJ', 'ER', 'SD', 'SS', 'LY', 'DZ', 'MA', 'TN', 'CM', 'SN', 'CI', 'ML', 'NE', 'BF', 'GN', 'SL', 'LR', 'TG', 'BJ', 'GA', 'CG', 'CD', 'AO', 'MZ', 'ZW', 'ZM', 'MW', 'BW', 'NA', 'MG', 'MU', 'SC']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(s) {
  return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRegion(countryCode) {
  const cc = clean(countryCode).toUpperCase();
  if (!cc) return '';
  if (regionOutputMap[cc]) return regionOutputMap[cc];
  if (africaCodes.has(cc)) return 'Africa';
  return cc;
}

function stripDiacritics(s) {
  return clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function codeRegex(code) {
  return new RegExp(`(^|[^A-Za-z0-9])${code}(?=$|[^A-Za-z0-9]|[\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF])`, 'i');
}

function countryCodeFromFlagEmoji(flag) {
  const chars = Array.from(String(flag || ''));
  if (chars.length !== 2) return '';
  const a = chars[0].codePointAt(0) - 0x1f1e6 + 65;
  const b = chars[1].codePointAt(0) - 0x1f1e6 + 65;
  if (a < 65 || a > 90 || b < 65 || b > 90) return '';
  return String.fromCharCode(a, b);
}

function explicitRegionFromName(name) {
  const raw = clean(name);
  const lower = stripDiacritics(raw).toLowerCase();
  const hits = [];
  const add = (region, keyword) => hits.push({ region, keyword });

  const flags = raw.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [];
  for (const flag of flags) {
    const cc = countryCodeFromFlagEmoji(flag);
    const region = normalizeRegion(cc);
    if (region) add(region, `${flag}(${cc})`);
  }

  const aliases = [
    ['MY', ['大马', '大馬', '马来西亚', '馬來西亞', 'malaysia']],
    ['EUR', ['belgique', 'belgien']],
    ['EUR', ['cz/sk', 'cz sk', 'cesko', 'česko', 'slovensko']],
    ['HK', ['hong kong', '香港']],
    ['TW', ['taiwan', '台灣', '台湾']],
    ['PH', ['philippines', 'pinoy', 'pilipinas']],
    ['ID', ['indonesia']],
    ['VN', ['vietnam', 'viet nam']],
    ['TH', ['thailand', 'thai']],
    ['JP', ['japan']],
    ['KR', ['korea', 'korean']],
    ['FR', ['france', 'francophone']],
    ['DE', ['germany', 'deutschland']],
    ['IT', ['italy', 'italia']],
    ['BR', ['brazil', 'brasil']],
    ['LATAM', ['latam', 'latin america', 'america latina', 'latinoamerica']],
    ['North America', ['usa', 'u.s.a.', 'united states', 'canada']],
    ['Oceania', ['australia', 'new zealand']],
    ['Middle East', ['middle east', 'mena', 'arabic']],
  ];
  for (const [region, words] of aliases) {
    for (const word of words) {
      const normalizedWord = stripDiacritics(word).toLowerCase();
      if (lower.includes(normalizedWord)) add(region, word);
    }
  }

  for (const code of ['HK', 'TW', 'JP', 'KR', 'TH', 'VN', 'PH', 'ID', 'MY', 'SG', 'FR', 'DE', 'IT', 'PL', 'TR', 'NL', 'BR', 'CZ', 'SK']) {
    if (codeRegex(code).test(raw)) add(normalizeRegion(code), code);
  }

  const uniqueRegions = Array.from(new Set(hits.map((h) => h.region).filter(Boolean)));
  if (!uniqueRegions.length) return null;
  if (uniqueRegions.length === 1) return { region: uniqueRegions[0], hits, status: 'local_explicit' };
  const buckets = new Set(uniqueRegions.map((r) => {
    if (['HK', 'TW', 'JP', 'KR', 'CN', 'MO'].includes(r)) return 'EA';
    if (['TH', 'VN', 'PH', 'ID', 'MY', 'SG', 'LA', 'KH', 'MM'].includes(r)) return 'SEA';
    return r;
  }));
  if (buckets.size === 1) return { region: Array.from(buckets)[0], hits, status: 'local_same_business_region' };
  return { region: '', hits, status: 'local_keyword_conflict' };
}

function candidateQueries(groupName) {
  let s = clean(groupName);
  s = s.replace(/pok[eéè]mon/ig, ' ');
  s = s.replace(/\bpokemon\b/ig, ' ');
  s = s.replace(/\bgo\b/ig, ' ');
  s = s.replace(/\b(remote|raid|raids|invites?|trainer|codes?|friendship|friends?|gift|gifts|buy|buying|sell|selling|rare|trade|trades|trading|account|accounts|service|services|regional|community|group|global|worldwide|world|wide|international|official|fly|free|fans?|exchange|hub|sale|news|unite|united|mundial|latinos?|and|mas|more|changes?|intercambios?|cambios|alrededores|around|nearby|pokemons?|pokemon)\b/ig, ' ');
  s = s.replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ');
  s = s.replace(/[()[\]{}|/&,+:;!?.'"“”‘’🔥✨🌍]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const hardStopwords = new Set([
    'remote', 'raid', 'raids', 'invite', 'invites', 'trainer', 'code', 'codes', 'friend', 'friends',
    'friendship', 'gift', 'gifts', 'buy', 'buying', 'sell', 'selling', 'rare', 'trade', 'trades', 'trading', 'account', 'accounts',
    'service', 'services', 'regional', 'community', 'group', 'global', 'worldwide', 'world', 'wide', 'international',
    'official', 'fly', 'free', 'fan', 'fans', 'exchange', 'hub', 'sale', 'news', 'unite', 'united',
    'mundial', 'latino', 'latinos', 'latina', 'latinas', 'and', 'mas', 'more', 'change', 'changes',
    'intercambio', 'intercambios', 'cambio', 'cambios', 'alrededores', 'around', 'nearby', 'pokemon', 'pokemons', 'pokémon'
  ]);
  const tokens = s.split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ\u4E00-\u9FFF]+|[^A-Za-zÀ-ÖØ-öø-ÿ\u4E00-\u9FFF]+$/g, ''))
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
    .filter((t) => !hardStopwords.has(stripDiacritics(t).toLowerCase()));
  const queries = [];
  const text = tokens.join(' ').trim();
  if (text) queries.push(text);
  for (const token of tokens) queries.push(token);

  return Array.from(new Set(queries))
    .filter((q) => !hardStopwords.has(stripDiacritics(q).toLowerCase()))
    .slice(0, 4);
}

function geonamesRequest(query, username) {
  return new Promise((resolve) => {
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('username', username);
    url.searchParams.set('maxRows', String(maxRows));
    url.searchParams.set('featureClass', 'P');
    url.searchParams.append('featureClass', 'A');
    url.searchParams.set('style', 'FULL');
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.status) {
            resolve({ ok: false, status: 'geonames_api_error', reason: json.status.message || '', endpoint });
          } else {
            resolve({ ok: true, json, endpoint });
          }
        } catch (error) {
          resolve({ ok: false, status: 'parse_error', reason: error.message, endpoint });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 'timeout', reason: 'request_timeout', endpoint });
    });
    req.on('error', (error) => {
      resolve({ ok: false, status: 'network_error', reason: error.message, endpoint });
    });
  });
}

function confidence(query, row, rankIndex) {
  const q = stripDiacritics(query).toLowerCase();
  const name = stripDiacritics(row.name || '').toLowerCase();
  const ascii = stripDiacritics(row.asciiName || '').toLowerCase();
  let score = 0.55;
  if (q === name || q === ascii) score += 0.25;
  else if (name.startsWith(q) || ascii.startsWith(q)) score += 0.12;
  const pop = Number(row.population || 0);
  if (pop >= 1000000) score += 0.08;
  else if (pop >= 100000) score += 0.05;
  else if (pop >= 10000) score += 0.03;
  if (rankIndex === 0) score += 0.05;
  return Math.min(0.99, score);
}

function evaluateGeonames(query, response) {
  if (!response.ok) return { status: response.status || 'geonames_error', reason: response.reason || '', endpoint: response.endpoint };
  const rows = (response.json.geonames || [])
    .filter((r) => r && r.countryCode)
    .map((r, idx) => ({ row: r, confidence: confidence(query, r, idx) }))
    .sort((a, b) => b.confidence - a.confidence);
  if (!rows.length) return { status: 'no_result', endpoint: response.endpoint };
  const top = rows[0];
  if (top.confidence < minConfidence) {
    return { status: 'low_confidence', endpoint: response.endpoint, row: top.row, confidence: top.confidence };
  }
  const second = rows[1];
  if (second && second.row.countryCode !== top.row.countryCode && top.confidence - second.confidence < 0.04) {
    return { status: 'ambiguous', endpoint: response.endpoint, row: top.row, confidence: top.confidence };
  }
  return {
    status: 'accepted',
    endpoint: response.endpoint,
    row: top.row,
    confidence: top.confidence,
    region: normalizeRegion(top.row.countryCode),
  };
}

function readUsername() {
  const localPath = path.resolve('config/local/geonames.local.json');
  let username = process.env.GEONAMES_USERNAME || '';
  if (fs.existsSync(localPath)) {
    const raw = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const nested = raw.external_geocoder && typeof raw.external_geocoder === 'object' ? raw.external_geocoder : raw;
    username = username || nested.username || '';
  }
  return clean(username);
}

function setCell(ws, address, value) {
  ws[address] = { t: 's', v: String(value || '') };
}

async function main() {
  const username = readUsername();
  if (!username) throw new Error('GeoNames username not found in config/local/geonames.local.json or GEONAMES_USERNAME');
  if (!fs.existsSync(inputXlsx)) throw new Error(`Missing input: ${inputXlsx}`);
  fs.copyFileSync(inputXlsx, backupXlsx);

  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const wb = XLSX.readFile(inputXlsx, { cellDates: false, cellFormula: true, cellStyles: true });
  const ws = wb.Sheets.detail;
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const audit = {
    input_xlsx: inputXlsx,
    output_xlsx: outputXlsx,
    backup_xlsx: backupXlsx,
    started_at: new Date().toISOString(),
    total_rows: rows.length,
    empty_region_before: 0,
    local_filled: 0,
    geonames_attempted_rows: 0,
    geonames_requests: 0,
    geonames_filled: 0,
    no_candidate_query: 0,
    no_result_or_not_accepted: 0,
    rows: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const excelRow = i + 2;
    const row = rows[i];
    const currentRegion = clean(row.region);
    const groupName = clean(row.group_name);
    if (currentRegion) continue;
    audit.empty_region_before++;

    const local = explicitRegionFromName(groupName);
    if (local && local.region) {
      setCell(ws, `B${excelRow}`, local.region);
      setCell(ws, `R${excelRow}`, local.status);
      setCell(ws, `S${excelRow}`, local.hits.map((h) => `${h.keyword}->${h.region}`).join('|'));
      setCell(ws, `V${excelRow}`, 'local_rule');
      audit.local_filled++;
      audit.rows.push({ row: excelRow, group_name: groupName, action: 'local_filled', region: local.region, hits: local.hits });
      continue;
    }

    const queries = candidateQueries(groupName);
    if (!queries.length) {
      setCell(ws, `V${excelRow}`, 'no_candidate_query');
      setCell(ws, `Y${excelRow}`, '');
      audit.no_candidate_query++;
      audit.rows.push({ row: excelRow, group_name: groupName, action: 'no_candidate_query' });
      continue;
    }

    audit.geonames_attempted_rows++;
    let accepted = null;
    const attempted = [];
    let lastResult = null;
    for (const query of queries) {
      attempted.push(query);
      const cacheKey = `${endpoint}|${query.toLowerCase()}`;
      let evaluated = cache[cacheKey];
      if (!evaluated) {
        await sleep(rateLimitMs);
        const response = await geonamesRequest(query, username);
        audit.geonames_requests++;
        evaluated = evaluateGeonames(query, response);
        evaluated.query = query;
        if (!['network_error', 'timeout', 'parse_error', 'geonames_api_error'].includes(evaluated.status)) {
          cache[cacheKey] = evaluated;
        }
      }
      lastResult = evaluated;
      if (evaluated.status === 'accepted' && evaluated.region) {
        accepted = evaluated;
        break;
      }
    }

    if (accepted) {
      const r = accepted.row || {};
      setCell(ws, `B${excelRow}`, accepted.region);
      setCell(ws, `R${excelRow}`, 'external_geocoder_group_name');
      setCell(ws, `U${excelRow}`, 'geonames');
      setCell(ws, `V${excelRow}`, 'accepted');
      setCell(ws, `W${excelRow}`, 'group_name');
      setCell(ws, `X${excelRow}`, accepted.query || '');
      setCell(ws, `Y${excelRow}`, attempted.join('|'));
      setCell(ws, `Z${excelRow}`, endpoint);
      setCell(ws, `AA${excelRow}`, '');
      setCell(ws, `AB${excelRow}`, r.countryCode || '');
      setCell(ws, `AC${excelRow}`, r.name || r.asciiName || '');
      setCell(ws, `AD${excelRow}`, r.adminName1 || '');
      setCell(ws, `AE${excelRow}`, Number(accepted.confidence || 0).toFixed(2));
      audit.geonames_filled++;
      audit.rows.push({ row: excelRow, group_name: groupName, action: 'geonames_filled', region: accepted.region, query: accepted.query, country_code: r.countryCode || '', place_name: r.name || '', confidence: accepted.confidence });
    } else {
      const status = lastResult ? lastResult.status : 'no_result';
      setCell(ws, `U${excelRow}`, lastResult && lastResult.provider ? lastResult.provider : 'geonames');
      setCell(ws, `V${excelRow}`, status);
      setCell(ws, `W${excelRow}`, 'group_name');
      setCell(ws, `X${excelRow}`, lastResult && lastResult.query ? lastResult.query : queries[0]);
      setCell(ws, `Y${excelRow}`, attempted.join('|'));
      setCell(ws, `Z${excelRow}`, endpoint);
      setCell(ws, `AA${excelRow}`, lastResult && lastResult.reason ? lastResult.reason : '');
      const r = lastResult && lastResult.row ? lastResult.row : {};
      setCell(ws, `AB${excelRow}`, r.countryCode || '');
      setCell(ws, `AC${excelRow}`, r.name || r.asciiName || '');
      setCell(ws, `AD${excelRow}`, r.adminName1 || '');
      setCell(ws, `AE${excelRow}`, lastResult && lastResult.confidence ? Number(lastResult.confidence).toFixed(2) : '');
      audit.no_result_or_not_accepted++;
      audit.rows.push({ row: excelRow, group_name: groupName, action: 'not_filled', status, attempted });
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  }

  const rowsAfter = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  audit.empty_region_after = rowsAfter.filter((r) => !clean(r.region)).length;
  audit.completed_at = new Date().toISOString();
  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2), 'utf8');
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  XLSX.writeFile(wb, outputXlsx, { bookType: 'xlsx', cellStyles: true });
  console.log(JSON.stringify({
    output_xlsx: outputXlsx,
    audit_file: auditFile,
    backup_xlsx: backupXlsx,
    empty_region_before: audit.empty_region_before,
    empty_region_after: audit.empty_region_after,
    local_filled: audit.local_filled,
    geonames_attempted_rows: audit.geonames_attempted_rows,
    geonames_requests: audit.geonames_requests,
    geonames_filled: audit.geonames_filled,
    no_candidate_query: audit.no_candidate_query,
    no_result_or_not_accepted: audit.no_result_or_not_accepted,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
