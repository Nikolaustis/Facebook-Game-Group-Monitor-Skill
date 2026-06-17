const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { createCodexProgressReporter, parseProgressReportEveryMinutes } = require('./progress_reporter');

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

function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeWords(s) {
  return stripDiacritics(clean(s))
    .normalize('NFKC')
    .replace(/[:：]+/g, ' ')
    .replace(/[×✕✖]/g, ' x ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(s) {
  return normalizeWords(s).toLowerCase().replace(/\s+/g, '');
}

function titleCaseLoose(s) {
  return clean(s)
    .split(/\s+/)
    .map((tk) => {
      if (/^[A-Z0-9]+$/.test(tk)) return tk;
      if (tk.length <= 1) return tk.toUpperCase();
      return tk.slice(0, 1).toUpperCase() + tk.slice(1);
    })
    .join(' ');
}

function uniqueObjectsByKey(list, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function slugify(s) {
  const base = clean(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const hash = crypto.createHash('sha1').update(clean(s)).digest('hex').slice(0, 8);
  return base ? `${base}_${hash}` : `game_${hash}`;
}

function parseMemberCount(text) {
  const t = clean(text);
  let m;
  m = t.match(/([0-9][0-9,]*)\s*位成员/i);
  if (m) return Number(String(m[1]).replace(/,/g, ''));
  m = t.match(/([0-9]+(?:\.[0-9]+)?)\s*万位成员/i);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = t.match(/([0-9]+(?:\.[0-9]+)?)\s*k\s*members?/i);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = t.match(/([0-9][0-9,]*)\s*members?/i);
  if (m) return Number(String(m[1]).replace(/,/g, ''));
  m = t.match(/([0-9][0-9,]*)\s*thành viên/i);
  if (m) return Number(String(m[1]).replace(/,/g, ''));
  m = t.match(/สมาชิก(?:ทั้งหมด)?[:：]?\s*([0-9][0-9,]*)\s*คน/i);
  if (m) return Number(String(m[1]).replace(/,/g, ''));
  return '';
}

function meaningfulTokens(text) {
  const stop = new Set(['the','and','for','with','from','this','that','your','game','games','group','official','mobile','online','of','on','to','in','m']);
  return clean(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !stop.has(s));
}

function loadConfig(configFile) {
  if (!configFile) return {};
  const p = path.resolve(configFile);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadGamesFromFile(gamesFile) {
  if (!gamesFile) return [];
  const p = path.resolve(gamesFile);
  const raw = fs.readFileSync(p, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    return raw
      .split(/\r?\n/)
      .map((s) => clean(s))
      .filter(Boolean);
  }
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.games;
  if (!Array.isArray(list)) {
    throw new Error(`Games file must be a JSON array or an object with a games array: ${p}`);
  }
  return list.map((s) => clean(String(s))).filter(Boolean);
}

function getTitleOverride(config, gameName) {
  const overrides = config.title_variant_overrides && typeof config.title_variant_overrides === 'object'
    ? config.title_variant_overrides
    : {};
  return overrides[gameName] || {};
}

function buildAutomaticSearchVariants(gameName) {
  const raw = clean(gameName);
  const normalized = normalizeWords(raw);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const variants = [
    { query: raw, type: 'canonical' },
  ];

  if (normalized && normalized !== raw) variants.push({ query: normalized, type: 'punctuation_normalized' });

  if (tokens.length >= 2) {
    // Merge one adjacent token pair at a time: "All Star Tower Defense" -> "Allstar Tower Defense", "All Star TowerDefense".
    for (let i = 0; i < tokens.length - 1; i++) {
      const merged = tokens.map((tk, idx) => (idx === i ? `${tk}${tokens[i + 1]}` : (idx === i + 1 ? '' : tk))).filter(Boolean).join(' ');
      if (merged) variants.push({ query: titleCaseLoose(merged), type: 'compact_spacing' });
    }

    // Merge common word-pairs: "Allstar TowerDefense". This is still a controlled spacing variant, not a broad keyword expansion.
    if (tokens.length >= 4) {
      const pairMerged = [];
      for (let i = 0; i < tokens.length; i += 2) {
        if (i + 1 < tokens.length) pairMerged.push(`${tokens[i]}${tokens[i + 1]}`);
        else pairMerged.push(tokens[i]);
      }
      variants.push({ query: titleCaseLoose(pairMerged.join(' ')), type: 'compact_spacing' });
    }
  }

  return uniqueObjectsByKey(variants, (v) => normalizeWords(v.query).toLowerCase());
}

function buildSearchPlan(gameName, config) {
  const override = getTitleOverride(config, gameName);
  const plan = override.search_variants_only ? [] : buildAutomaticSearchVariants(gameName);
  const explicitVariants = Array.isArray(override.search_variants) ? override.search_variants : [];
  for (const item of explicitVariants) {
    if (typeof item === 'string') {
      plan.push({ query: clean(item), type: 'configured_variant' });
      continue;
    }
    if (item && typeof item === 'object' && clean(item.query)) {
      plan.push({
        query: clean(item.query),
        type: clean(item.type) || 'configured_variant',
        threshold: item,
      });
    }
  }
  return uniqueObjectsByKey(plan, (v) => `${v.type}::${normalizeWords(v.query).toLowerCase()}`);
}

async function gotoWithRetry(page, url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(2500 + i * 1500);
    }
  }
  throw lastError;
}

function buildSeedCandidates(gameName, config) {
  const override = getTitleOverride(config, gameName);
  const urls = Array.isArray(override.seed_group_urls) ? override.seed_group_urls : [];
  return urls.map((url) => ({
    group_name: '',
    group_url: clean(url).split('?')[0].replace(/\/+$/, ''),
    snippet: '',
    card_group_size: 100,
    source_game_name: gameName,
    source_query: '[seed_group_url]',
    query_variant_type: 'seed_group_url',
    source_is_seed_url: true,
    source_queries: ['[seed_group_url]'],
    query_variant_types: ['seed_group_url'],
  })).filter((x) => x.group_url);
}

async function collectRound(page, gameName, sourceQuery, variantType) {
  const queryTokens = Array.from(new Set([...meaningfulTokens(gameName), ...meaningfulTokens(sourceQuery)]));
  return page.evaluate(({ queryTokens, sourceQuery, variantType, gameName }) => {
    const main = document.querySelector('div[role="main"]') || document.body;
    const out = [];
    const anchors = Array.from(main.querySelectorAll('a[href*="/groups/"]'));
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    for (const a of anchors) {
      const href = a.href || '';
      if (!/facebook\.com\/groups\//i.test(href)) continue;
      if (/posts|permalink|media_set|search\//i.test(href)) continue;
      const groupName = (a.innerText || '').replace(/\s+/g, ' ').trim();
      if (!groupName || groupName.length < 2) continue;
      const card =
        a.closest('div[role="article"], div[role="listitem"], div.x1n2onr6, div.x1yztbdb') ||
        a.parentElement;
      const snippet = (card?.innerText || '').replace(/\s+/g, ' ').trim();
      const combined = normalize(`${groupName} ${snippet}`);
      if (queryTokens.length && !queryTokens.some((tk) => combined.includes(tk))) continue;
      const looksLikeGroupCard = /members?|位成员|thành viên|สมาชิก/i.test(snippet) || groupName.length >= 2;
      if (!looksLikeGroupCard) continue;
      out.push({
        group_name: groupName,
        group_url: href.split('?')[0].replace(/\/+$/, ''),
        snippet,
        source_game_name: gameName,
        source_query: sourceQuery,
        query_variant_type: variantType,
        source_is_seed_url: false,
        source_queries: [sourceQuery],
        query_variant_types: [variantType],
      });
    }
    return out;
  }, { queryTokens, sourceQuery, variantType, gameName });
}

async function hasNoMoreResultsSignal(page) {
  return page.evaluate(() => {
    const txt = (document.body?.innerText || '').replace(/\s+/g, ' ');
    return /已经到底啦|已經到底啦|已经到底了|已到最底|没有更多结果|沒有更多結果|no more results|you've reached the end|end of results/i.test(txt);
  });
}

function mergeCandidate(existing, incoming) {
  const sourceQueries = Array.from(new Set([...(existing.source_queries || []), ...(incoming.source_queries || []), incoming.source_query].filter(Boolean)));
  const variantTypes = Array.from(new Set([...(existing.query_variant_types || []), ...(incoming.query_variant_types || []), incoming.query_variant_type].filter(Boolean)));
  const cardA = parseMemberCount(existing.snippet);
  const cardB = parseMemberCount(incoming.snippet);
  const betterIncomingSnippet = (cardB && !cardA) || ((incoming.snippet || '').length > (existing.snippet || '').length && !existing.source_is_seed_url);
  return {
    ...existing,
    group_name: clean(existing.group_name) || clean(incoming.group_name),
    snippet: betterIncomingSnippet ? incoming.snippet : existing.snippet,
    card_group_size: cardB || existing.card_group_size || '',
    source_query: existing.source_query || incoming.source_query,
    query_variant_type: existing.query_variant_type || incoming.query_variant_type,
    source_is_seed_url: Boolean(existing.source_is_seed_url || incoming.source_is_seed_url),
    source_queries: sourceQueries,
    query_variant_types: variantTypes,
  };
}

async function runOneSearchQuery(page, gameName, variant, maxMinutes, progressState) {
  if (progressState) {
    progressState.current_query = variant.query;
    progressState.current_query_variant_type = variant.type;
    progressState.current_round = 0;
    progressState.current_query_candidates = 0;
    progressState.current_query_started_at = new Date().toISOString();
  }
  const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(variant.query)}`;
  await gotoWithRetry(page, searchUrl);
  await page.waitForTimeout(4500);

  const startedAt = Date.now();
  const map = new Map();
  const stats = [];
  let rounds = 0;
  let noNewStreak = 0;
  let noGrowthStreak = 0;
  let prevTotal = 0;
  let stopReason = '';

  while (true) {
    rounds++;
    let got = [];
    try {
      got = await collectRound(page, gameName, variant.query, variant.type);
    } catch (_e) {
      await gotoWithRetry(page, searchUrl);
      await page.waitForTimeout(3000);
      got = await collectRound(page, gameName, variant.query, variant.type);
    }

    let newGroups = 0;
    for (const g of got) {
      const key = g.group_url;
      const withSize = { ...g, card_group_size: parseMemberCount(g.snippet) };
      if (!map.has(key)) {
        map.set(key, withSize);
        newGroups++;
      } else {
        map.set(key, mergeCandidate(map.get(key), withSize));
      }
    }

    if (newGroups === 0) noNewStreak++;
    else noNewStreak = 0;

    if (map.size === prevTotal) noGrowthStreak++;
    else noGrowthStreak = 0;
    prevTotal = map.size;

    const noMore = await hasNoMoreResultsSignal(page);
    const elapsed = Date.now() - startedAt;
    if (progressState) {
      progressState.current_round = rounds;
      progressState.current_query_candidates = map.size;
      progressState.total_candidates = Math.max(progressState.total_candidates || 0, (progressState.completed_candidates || 0) + map.size);
      progressState.last_round_new_groups = newGroups;
      progressState.last_round_no_new_streak = noNewStreak;
      progressState.last_round_no_growth_streak = noGrowthStreak;
      progressState.last_no_more_results_signal = noMore;
      progressState.last_updated_at = new Date().toISOString();
    }

    stats.push({
      query: variant.query,
      query_variant_type: variant.type,
      round: rounds,
      new_groups: newGroups,
      total_unique: map.size,
      no_new_streak: noNewStreak,
      no_growth_streak: noGrowthStreak,
      no_more_results_signal: noMore,
      elapsed_sec: Math.floor(elapsed / 1000),
    });

    console.log(JSON.stringify({ game: gameName, query: variant.query, variant_type: variant.type, round: rounds, new_groups: newGroups, total_unique: map.size }));

    if (noMore) {
      stopReason = 'NO_MORE_RESULTS_SIGNAL';
      break;
    }
    if (noNewStreak >= 3) {
      stopReason = 'NO_NEW_GROUPS_3_SCROLLS';
      break;
    }
    if (noGrowthStreak >= 3) {
      stopReason = 'LIST_NOT_GROWING';
      break;
    }
    if (elapsed > maxMinutes * 60 * 1000) {
      stopReason = 'TIME_GUARD';
      break;
    }

    await page.mouse.wheel(0, 3200);
    await page.waitForTimeout(1300);
  }

  return {
    query: variant.query,
    query_variant_type: variant.type,
    stop_reason: stopReason,
    rounds,
    candidates: Array.from(map.values()),
    stats,
  };
}

async function runOneGame(page, gameName, maxMinutes, config, progressState) {
  const searchPlan = buildSearchPlan(gameName, config);
  const map = new Map();
  const allStats = [];
  const queryRuns = [];

  const perVariantMaxMinutes = Math.max(8, Math.ceil(maxMinutes / Math.max(searchPlan.length, 1)));
  if (progressState) {
    progressState.search_plan_count = searchPlan.length;
    progressState.per_variant_max_minutes = perVariantMaxMinutes;
  }
  for (let variantIdx = 0; variantIdx < searchPlan.length; variantIdx++) {
    const variant = searchPlan[variantIdx];
    if (progressState) {
      progressState.current_query_index = variantIdx + 1;
      progressState.current_query_total = searchPlan.length;
    }
    const one = await runOneSearchQuery(page, gameName, variant, perVariantMaxMinutes, progressState);
    queryRuns.push({
      query: one.query,
      query_variant_type: one.query_variant_type,
      stop_reason: one.stop_reason,
      rounds: one.rounds,
      candidates_count: one.candidates.length,
    });
    allStats.push(...one.stats);
    if (progressState) {
      progressState.completed_queries = (progressState.completed_queries || 0) + 1;
      progressState.completed_candidates = map.size;
      progressState.total_candidates = Math.max(progressState.total_candidates || 0, map.size);
      progressState.last_query_stop_reason = one.stop_reason;
      progressState.last_updated_at = new Date().toISOString();
    }
    for (const c of one.candidates) {
      if (!map.has(c.group_url)) map.set(c.group_url, c);
      else map.set(c.group_url, mergeCandidate(map.get(c.group_url), c));
    }
  }

  for (const seed of buildSeedCandidates(gameName, config)) {
    if (!map.has(seed.group_url)) map.set(seed.group_url, seed);
    else map.set(seed.group_url, mergeCandidate(map.get(seed.group_url), seed));
  }

  return {
    game_name: gameName,
    stop_reason: queryRuns.map((x) => `${x.query_variant_type}:${x.stop_reason}`).join('|'),
    rounds: queryRuns.reduce((sum, x) => sum + (x.rounds || 0), 0),
    search_plan: searchPlan,
    per_variant_max_minutes: perVariantMaxMinutes,
    query_runs: queryRuns,
    candidates: Array.from(map.values()),
    stats: allStats,
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const games = args['games-file']
    ? loadGamesFromFile(args['games-file'])
    : (args.games || '')
      .split(',')
      .map((s) => clean(s))
      .filter(Boolean);

  if (!games.length) {
    console.error('Usage: node phase1_collect_candidates.js --games "LINE Rangers,sealm on cross" --out-dir "./runs/xxx" --config "./task_config.json"');
    console.error('   or: node phase1_collect_candidates.js --games-file "./games.json" --out-dir "./runs/xxx" --config "./task_config.json"');
    process.exit(1);
  }

  const outDir = path.resolve(args['out-dir'] || `./runs/${Date.now()}`);
  const maxMinutes = Number(args['max-minutes'] || 90);
  const config = loadConfig(args.config || '');
  const progressReportEveryMinutes = parseProgressReportEveryMinutes(args, config, 30);
  const outCodexProgress = path.resolve(args['out-codex-progress'] || args['progress-report'] || path.join(outDir, 'codex_progress_report.json'));
  fs.mkdirSync(outDir, { recursive: true });

  const progressState = {
    phase: 'phase1',
    out_dir: outDir,
    total_games: games.length,
    current_game_name: '',
    current_game_index: 0,
    completed_games: 0,
    current_query: '',
    current_query_variant_type: '',
    current_round: 0,
    current_query_candidates: 0,
    completed_queries: 0,
    completed_candidates: 0,
    total_candidates: 0,
    last_updated_at: new Date().toISOString(),
  };
  const codexProgressReporter = createCodexProgressReporter({
    phase: 'phase1',
    intervalMinutes: progressReportEveryMinutes,
    outFile: outCodexProgress,
    getProgress: () => ({ ...progressState }),
  });

  const browser = await chromium.connectOverCDP(args.cdp || config.cdp_url || 'http://127.0.0.1:9222');
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages().find((p) => p.url().includes('facebook.com')) || (await context.newPage());

  try {
    const index = {
      created_at: new Date().toISOString(),
      mode: 'phase1',
      games: [],
      out_dir: outDir,
      config_file: args.config ? path.resolve(args.config) : '',
      variant_policy: {
        automatic: ['canonical', 'punctuation_normalized', 'compact_spacing'],
        configured_only: ['connector_x', 'configured_variant', 'seed_group_url'],
      },
    };

    for (let gameIdx = 0; gameIdx < games.length; gameIdx++) {
      const gameName = games[gameIdx];
      progressState.current_game_name = gameName;
      progressState.current_game_index = gameIdx + 1;
      progressState.current_query = '';
      progressState.current_query_variant_type = '';
      progressState.current_round = 0;
      progressState.current_query_candidates = 0;
      progressState.completed_candidates = 0;
      progressState.last_updated_at = new Date().toISOString();
      codexProgressReporter.writeSnapshot('game_started');

      const one = await runOneGame(page, gameName, maxMinutes, config, progressState);
      const slug = slugify(gameName);
      const candidatesFile = path.join(outDir, `phase1_${slug}_candidates.json`);
      const statsFile = path.join(outDir, `phase1_${slug}_stats.json`);

      fs.writeFileSync(candidatesFile, JSON.stringify(one.candidates, null, 2), 'utf8');
      fs.writeFileSync(statsFile, JSON.stringify({ stats: one.stats, query_runs: one.query_runs, search_plan: one.search_plan, per_variant_max_minutes: one.per_variant_max_minutes }, null, 2), 'utf8');

      progressState.completed_games = gameIdx + 1;
      progressState.completed_candidates = one.candidates.length;
      progressState.total_candidates = index.games.reduce((sum, item) => sum + (item.candidates_count || 0), 0) + one.candidates.length;
      progressState.last_game_stop_reason = one.stop_reason;
      progressState.last_updated_at = new Date().toISOString();
      codexProgressReporter.writeSnapshot('game_finished');

      index.games.push({
        game_name: gameName,
        slug,
        stop_reason: one.stop_reason,
        rounds: one.rounds,
        candidates_count: one.candidates.length,
        candidates_file: candidatesFile,
        stats_file: statsFile,
        search_plan: one.search_plan,
        per_variant_max_minutes: one.per_variant_max_minutes,
        query_runs: one.query_runs,
      });
    }

    const indexFile = path.join(outDir, 'phase1_index.json');
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8');

    progressState.phase1_index = indexFile;
    progressState.current_query = '';
    progressState.current_query_variant_type = '';
    progressState.current_round = 0;
    progressState.last_updated_at = new Date().toISOString();
    codexProgressReporter.writeSnapshot('phase1_finished');

    console.log(JSON.stringify({ ok: true, phase1_index: indexFile, games: index.games }, null, 2));
  } finally {
    codexProgressReporter.stop('phase1_stopped');
    await browser.close();
  }
})();
