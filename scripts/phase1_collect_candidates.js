const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

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

async function collectRound(page, gameName) {
  const queryTokens = meaningfulTokens(gameName);
  return page.evaluate((queryTokens) => {
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
        group_url: href.split('?')[0],
        snippet,
      });
    }
    return out;
  }, queryTokens);
}

async function hasNoMoreResultsSignal(page) {
  return page.evaluate(() => {
    const txt = (document.body?.innerText || '').replace(/\s+/g, ' ');
    return /已经到底啦|已經到底啦|已经到底了|已到最底|没有更多结果|沒有更多結果|no more results|you've reached the end|end of results/i.test(txt);
  });
}

async function runOneGame(page, gameName, maxMinutes) {
  const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(gameName)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
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
      got = await collectRound(page, gameName);
    } catch (_e) {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(3000);
      got = await collectRound(page, gameName);
    }

    let newGroups = 0;
    for (const g of got) {
      if (!map.has(g.group_url)) {
        map.set(g.group_url, {
          ...g,
          card_group_size: parseMemberCount(g.snippet),
        });
        newGroups++;
      }
    }

    if (newGroups === 0) noNewStreak++;
    else noNewStreak = 0;

    if (map.size === prevTotal) noGrowthStreak++;
    else noGrowthStreak = 0;
    prevTotal = map.size;

    const noMore = await hasNoMoreResultsSignal(page);
    const elapsed = Date.now() - startedAt;
    stats.push({
      round: rounds,
      new_groups: newGroups,
      total_unique: map.size,
      no_new_streak: noNewStreak,
      no_growth_streak: noGrowthStreak,
      no_more_results_signal: noMore,
      elapsed_sec: Math.floor(elapsed / 1000),
    });

    console.log(JSON.stringify({ game: gameName, round: rounds, new_groups: newGroups, total_unique: map.size }));

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
    game_name: gameName,
    stop_reason: stopReason,
    rounds,
    candidates: Array.from(map.values()),
    stats,
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const gamesRaw = args.games || '';
  const games = gamesRaw
    .split(',')
    .map((s) => clean(s))
    .filter(Boolean);

  if (!games.length) {
    console.error('Usage: node phase1_collect_candidates.js --games "LINE Rangers,sealm on cross" --out-dir "./runs/xxx"');
    process.exit(1);
  }

  const outDir = path.resolve(args['out-dir'] || `./runs/${Date.now()}`);
  const maxMinutes = Number(args['max-minutes'] || 90);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.connectOverCDP(args.cdp || 'http://127.0.0.1:9222');
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages().find((p) => p.url().includes('facebook.com')) || (await context.newPage());

  try {
    const index = {
      created_at: new Date().toISOString(),
      mode: 'phase1',
      games: [],
      out_dir: outDir,
    };

    for (const gameName of games) {
      const one = await runOneGame(page, gameName, maxMinutes);
      const slug = slugify(gameName);
      const candidatesFile = path.join(outDir, `phase1_${slug}_candidates.json`);
      const statsFile = path.join(outDir, `phase1_${slug}_stats.json`);

      fs.writeFileSync(candidatesFile, JSON.stringify(one.candidates, null, 2), 'utf8');
      fs.writeFileSync(statsFile, JSON.stringify(one.stats, null, 2), 'utf8');

      index.games.push({
        game_name: gameName,
        slug,
        stop_reason: one.stop_reason,
        rounds: one.rounds,
        candidates_count: one.candidates.length,
        candidates_file: candidatesFile,
        stats_file: statsFile,
      });
    }

    const indexFile = path.join(outDir, 'phase1_index.json');
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8');

    console.log(JSON.stringify({ ok: true, phase1_index: indexFile, games: index.games }, null, 2));
  } finally {
    await browser.close();
  }
})();
