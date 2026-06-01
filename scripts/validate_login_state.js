const fs = require('fs');
const path = require('path');
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

function loadConfig(configFile) {
  if (!configFile) return {};
  const p = path.resolve(configFile);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJsonAtomic(file, obj) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (_err) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_e) { /* ignore */ }
    try { fs.renameSync(tmp, file); } catch (_err2) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    }
  }
}

async function safePageText(page) {
  try {
    return clean(await page.locator('body').innerText({ timeout: 5000 }));
  } catch (_err) {
    return '';
  }
}

async function countLoginInputs(page) {
  try {
    return await page.locator('input[name="email"], input[name="pass"], form[action*="login"], input[type="password"]').count();
  } catch (_err) {
    return 0;
  }
}

function classifyLoginState(url, title, bodyText, loginInputCount) {
  const combined = `${url}\n${title}\n${bodyText}`;
  const checkpoint = /checkpoint|two_step_verification|recover|confirmemail|login_approval/i.test(url);
  const loggedOutByUrl = /facebook\.com\/(login|recover|r\.php|reg)(?:[/?#]|$)/i.test(url);
  const loggedOutByText = /(log in to facebook|登录 facebook|登入 facebook|เข้าสู่ระบบ Facebook|đăng nhập facebook|masuk ke facebook)/i.test(combined);
  const feedOrHome = /(facebook\.com\/(?:home\.php)?(?:[?#].*)?$|facebook\.com\/?$)/i.test(url);
  const hasLoggedOutIndicators = loginInputCount > 0 || loggedOutByUrl || loggedOutByText;

  if (checkpoint) {
    return {
      logged_in: false,
      status: 'checkpoint_or_verification_required',
      reason: 'Facebook 要求 checkpoint / 两步验证 / 账号恢复，不能开始采集。',
    };
  }
  if (hasLoggedOutIndicators) {
    return {
      logged_in: false,
      status: 'not_logged_in',
      reason: '页面仍出现登录表单或登录页文案。',
    };
  }
  if (/facebook\.com/i.test(url) && (feedOrHome || bodyText.length > 200)) {
    return {
      logged_in: true,
      status: 'logged_in',
      reason: '已连接到 Facebook 页面，未检测到登录表单、checkpoint 或恢复页面。',
    };
  }
  return {
    logged_in: false,
    status: 'unknown',
    reason: '无法确认是否已登录，请查看 Chrome 页面状态。',
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config || '');
  const cdpUrl = args.cdp || config.cdp_url || 'http://127.0.0.1:9222';
  const outStatus = path.resolve(args['out-status'] || args.out || './runs/login_state.json');
  let browser = null;
  let result;

  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages().find((p) => /facebook\.com/i.test(p.url())) || (await context.newPage());
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(2000);

    const url = page.url();
    const title = clean(await page.title().catch(() => ''));
    const bodyText = await safePageText(page);
    const loginInputCount = await countLoginInputs(page);
    const state = classifyLoginState(url, title, bodyText, loginInputCount);
    result = {
      ok: state.logged_in,
      event: 'facebook_login_state_validation',
      validated_at: new Date().toISOString(),
      cdp_url: cdpUrl,
      url,
      title,
      login_input_count: loginInputCount,
      ...state,
    };
  } catch (err) {
    result = {
      ok: false,
      event: 'facebook_login_state_validation',
      validated_at: new Date().toISOString(),
      cdp_url: cdpUrl,
      status: 'cdp_connection_failed',
      logged_in: false,
      reason: '无法连接 Chrome CDP，请先执行 npm run login 或确认 9222 端口 Chrome 已打开。',
      error: err && err.stack ? err.stack : String(err),
    };
  } finally {
    writeJsonAtomic(outStatus, result);
    console.log(JSON.stringify(result, null, 2));
    // Do not call browser.close() here: for a CDP-attached browser that closes
    // the real Chrome process and breaks the collector that runs next.
    process.exit(result && result.ok ? 0 : 2);
  }
})();
