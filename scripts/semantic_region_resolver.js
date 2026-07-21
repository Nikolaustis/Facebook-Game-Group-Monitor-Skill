const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { readJsonFile } = require('./json_io');

function scalarText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => scalarText(item)).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    for (const key of ['text', 'value', 'name', 'label']) {
      if (value[key] !== undefined && value[key] !== null) {
        const text = scalarText(value[key]);
        if (text) return text;
      }
    }
    return '';
  }
  return String(value);
}

function clean(value) {
  return scalarText(value).replace(/^\uFEFF/, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function boolLike(raw, defaultValue) {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  if (typeof raw === 'boolean') return raw;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  return defaultValue;
}

function numberInRange(raw, defaultValue, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
}

function readJsonIfExists(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return readJsonFile(file);
  } catch (_err) {
    return null;
  }
}

function resolveConfigPathMaybe(file, baseDir) {
  const value = clean(file || '');
  if (!value) return '';
  if (path.isAbsolute(value)) return value;
  const candidates = [
    path.resolve(process.cwd(), value),
    baseDir ? path.resolve(baseDir, value) : '',
  ].filter(Boolean);
  return candidates.find((item) => fs.existsSync(item)) || candidates[0] || '';
}

function writeJsonAtomic(file, value) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function deepMerge(base, override) {
  const output = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  if (!override || typeof override !== 'object' || Array.isArray(override)) return output;
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function getByPath(value, dottedPath) {
  const pathText = clean(dottedPath);
  if (!pathText) return value;
  const parts = pathText.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    const index = /^\d+$/.test(part) ? Number(part) : part;
    current = current[index];
  }
  return current;
}

function normalizeHeaders(raw) {
  const output = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return output;
  for (const [key, value] of Object.entries(raw)) {
    const header = clean(key);
    const text = scalarText(value);
    if (header && text) output[header] = text;
  }
  return output;
}

function maskSecret(value) {
  const text = clean(value);
  if (!text) return '';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

const LEGACY_GLOBAL_CODEX_ENV = 'CODEX_CLI_PATH';
const PRIVATE_SKILL_CODEX_ENV = 'FB_MONITOR_CODEX_CLI_PATH';

function getEnvironmentVariableCaseInsensitive(name) {
  const target = String(name || '').toUpperCase();
  for (const [key, value] of Object.entries(process.env)) {
    if (String(key).toUpperCase() === target) return value;
  }
  return undefined;
}

function hasEnvironmentVariableCaseInsensitive(name) {
  return getEnvironmentVariableCaseInsensitive(name) !== undefined;
}

function childEnvironmentWithoutLegacyCodexOverride() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (String(key).toUpperCase() === LEGACY_GLOBAL_CODEX_ENV) delete env[key];
  }
  return env;
}

class SemanticRegionCache {
  constructor(file) {
    this.file = file;
    this.data = readJsonIfExists(file) || {};
    if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) this.data = {};
  }

  get(key) {
    return this.data[key] || null;
  }

  set(key, value) {
    this.data[key] = { ...value, cached_at: new Date().toISOString() };
    try {
      writeJsonAtomic(this.file, this.data);
    } catch (_err) {
      // Semantic cache failures must never stop collection.
    }
  }
}

function expandEnvironmentVariables(value) {
  const text = clean(value);
  if (!text || process.platform !== 'win32') return text;
  return text.replace(/%([^%]+)%/g, (_match, name) => {
    if (String(name).toUpperCase() === LEGACY_GLOBAL_CODEX_ENV) return _match;
    return getEnvironmentVariableCaseInsensitive(name) || _match;
  });
}

function uniqueValues(values) {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = clean(value);
    if (!text) continue;
    const key = process.platform === 'win32' ? text.toLowerCase() : text;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function isWindowsAppsExecutionAlias(file) {
  const normalized = clean(file).replace(/\//g, '\\').toLowerCase();
  return normalized.includes('\\microsoft\\windowsapps\\');
}

function classifyCodexCandidate(file) {
  const ext = path.extname(clean(file)).toLowerCase();
  if (ext === '.exe') return 'native';
  if (ext === '.cmd' || ext === '.bat') return 'cmd';
  if (ext === '.ps1') return 'powershell';
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return 'node';
  if (process.platform !== 'win32' && !ext) return 'native';
  return 'unsupported';
}

function inspectCodexCandidate(file, source) {
  const expanded = expandEnvironmentVariables(file).replace(/^['"]|['"]$/g, '');
  const absolute = path.isAbsolute(expanded) ? path.normalize(expanded) : expanded;
  const candidate = {
    path: absolute,
    source: clean(source),
    kind: classifyCodexCandidate(absolute),
    exists: false,
    rejected: false,
    rejection_reason: '',
  };
  if (!absolute) {
    candidate.rejected = true;
    candidate.rejection_reason = 'empty_path';
    return candidate;
  }
  if (isWindowsAppsExecutionAlias(absolute)) {
    candidate.rejected = true;
    candidate.rejection_reason = 'windowsapps_app_execution_alias_not_background_safe';
    candidate.exists = true;
    return candidate;
  }
  try {
    candidate.exists = fs.existsSync(absolute);
    if (candidate.exists) {
      const stat = fs.statSync(absolute);
      candidate.size_bytes = stat.size;
      candidate.is_file = stat.isFile();
    }
  } catch (err) {
    candidate.rejected = true;
    candidate.rejection_reason = `stat_error:${clean(err.message || err)}`;
    return candidate;
  }
  if (!candidate.exists || candidate.is_file === false) {
    candidate.rejected = true;
    candidate.rejection_reason = 'path_missing_or_not_file';
  } else if (candidate.kind === 'unsupported') {
    candidate.rejected = true;
    candidate.rejection_reason = 'unsupported_executable_type';
  }
  return candidate;
}

function runDiscoveryCommand(command, args, timeout = 8000) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      shell: false,
      env: childEnvironmentWithoutLegacyCodexOverride(),
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      error: result.error ? clean(result.error.message || result.error) : '',
    };
  } catch (err) {
    return { ok: false, status: null, stdout: '', stderr: '', error: clean(err.message || err) };
  }
}

function discoverCodexCandidates(command, baseDir) {
  const requested = clean(command || 'codex');
  const raw = [];
  const add = (value, source) => {
    const text = clean(value);
    if (text) raw.push({ value: text, source });
  };

  const explicitLooksLikePath = path.isAbsolute(expandEnvironmentVariables(requested)) || /[\\/]/.test(requested);
  if (explicitLooksLikePath) add(resolveConfigPathMaybe(expandEnvironmentVariables(requested), baseDir), 'configured_path');
  const privateCodexCliPath = getEnvironmentVariableCaseInsensitive(PRIVATE_SKILL_CODEX_ENV);
  if (privateCodexCliPath) {
    add(resolveConfigPathMaybe(expandEnvironmentVariables(privateCodexCliPath), baseDir), 'env_FB_MONITOR_CODEX_CLI_PATH');
  }

  if (process.platform === 'win32') {
    for (const name of uniqueValues([requested, 'codex.exe', 'codex.cmd', 'codex.ps1'])) {
      if (/[\\/]/.test(name)) continue;
      const found = runDiscoveryCommand('where.exe', [name], 5000);
      for (const line of found.stdout.split(/\r?\n/)) add(line, `where:${name}`);
    }
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    const ps = runDiscoveryCommand(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      "$ErrorActionPreference='SilentlyContinue'; Get-Command codex -All | ForEach-Object { if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } }",
    ], 8000);
    for (const line of ps.stdout.split(/\r?\n/)) add(line, 'powershell:Get-Command');

    const npmShell = process.env.ComSpec || 'cmd.exe';
    const prefix = runDiscoveryCommand(npmShell, ['/d', '/s', '/c', 'npm prefix -g'], 8000);
    const root = runDiscoveryCommand(npmShell, ['/d', '/s', '/c', 'npm root -g'], 8000);
    const npmPrefix = clean(prefix.stdout.split(/\r?\n/)[0]);
    const npmRoot = clean(root.stdout.split(/\r?\n/)[0]);
    if (npmPrefix) {
      add(path.join(npmPrefix, 'codex.cmd'), 'npm_global_prefix');
      add(path.join(npmPrefix, 'codex.exe'), 'npm_global_prefix');
      add(path.join(npmPrefix, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), 'npm_global_prefix_package');
    }
    if (npmRoot) add(path.join(npmRoot, '@openai', 'codex', 'bin', 'codex.js'), 'npm_global_root_package');

    const home = process.env.USERPROFILE || process.env.HOME || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    for (const [file, source] of [
      [home && path.join(home, '.local', 'bin', 'codex.exe'), 'official_installer_default'],
      [home && path.join(home, 'bin', 'codex.exe'), 'user_bin'],
      [appData && path.join(appData, 'npm', 'codex.cmd'), 'npm_appdata'],
      [appData && path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), 'npm_appdata_package'],
      [localAppData && path.join(localAppData, 'Programs', 'codex', 'codex.exe'), 'local_programs'],
      [localAppData && path.join(localAppData, 'codex', 'codex.exe'), 'local_codex'],
      [programFiles && path.join(programFiles, 'Codex', 'codex.exe'), 'program_files'],
    ]) add(file, source);
  } else {
    for (const name of uniqueValues([requested, 'codex'])) {
      if (/[\\/]/.test(name)) continue;
      const found = runDiscoveryCommand('which', [name], 5000);
      for (const line of found.stdout.split(/\r?\n/)) add(line, `which:${name}`);
    }
  }

  const output = [];
  const seen = new Set();
  for (const entry of raw) {
    const candidate = inspectCodexCandidate(entry.value, entry.source);
    const key = process.platform === 'win32' ? candidate.path.toLowerCase() : candidate.path;
    if (!candidate.path || seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

function quoteCmdArg(value) {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^%!]/.test(text)) return text;
  return `"${text.replace(/%/g, '%%').replace(/"/g, '\\"')}"`;
}

function buildCandidateLaunch(candidate, args) {
  const list = Array.isArray(args) ? args.map((item) => String(item)) : [];
  if (!candidate || candidate.rejected) return null;
  if (candidate.kind === 'cmd') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const commandLine = [quoteCmdArg(candidate.path), ...list.map(quoteCmdArg)].join(' ');
    return { command: comspec, args: ['/d', '/s', '/c', commandLine], shell: false };
  }
  if (candidate.kind === 'powershell') {
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    return {
      command: powershell,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', candidate.path, ...list],
      shell: false,
    };
  }
  if (candidate.kind === 'node') return { command: process.execPath, args: [candidate.path, ...list], shell: false };
  return { command: candidate.path, args: list, shell: false };
}

function normalizeProviderOrder(_raw) {
  // V6.6.1 uses one fixed policy. Legacy task files cannot restore Codex-first
  // ordering or omit the API stage. Availability is controlled by each provider's
  // enabled/configured state, not by changing the chain.
  return ['custom_api', 'codex_exec', 'rules_only'];
}

function normalizeApiProvider(raw, baseDir, index) {
  const provider = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  provider.name = clean(provider.name || `api_${index + 1}`);
  provider.protocol = clean(provider.protocol || 'openai_chat_completions').toLowerCase();
  const validProtocols = ['openai_responses', 'openai_chat_completions', 'anthropic_messages', 'gemini_generate_content', 'generic_json'];
  if (!validProtocols.includes(provider.protocol)) provider.protocol = 'generic_json';
  provider.endpoint = clean(provider.endpoint || '');
  provider.model = clean(provider.model || '');
  provider.api_key_env = clean(provider.api_key_env || 'SEMANTIC_MODEL_API_KEY');
  provider.api_key = clean(provider.api_key || (provider.api_key_env ? process.env[provider.api_key_env] : '') || '');
  provider.timeout_ms = numberInRange(provider.timeout_ms, 30000, 1000, 300000);
  provider.retry_count = numberInRange(provider.retry_count, 1, 0, 3);
  provider.retry_backoff_ms = numberInRange(provider.retry_backoff_ms, 1200, 250, 30000);
  provider.max_output_tokens = numberInRange(provider.max_output_tokens, 500, 100, 4000);
  provider.rate_limit_ms = numberInRange(provider.rate_limit_ms, 250, 0, 60000);
  provider.reasoning_effort = clean(provider.reasoning_effort || '').toLowerCase();
  provider.headers = normalizeHeaders(provider.headers);
  provider.query = provider.query && typeof provider.query === 'object' && !Array.isArray(provider.query) ? { ...provider.query } : {};
  provider.auth = provider.auth && typeof provider.auth === 'object' && !Array.isArray(provider.auth) ? { ...provider.auth } : {};
  provider.auth.type = clean(provider.auth.type || 'header').toLowerCase();
  provider.auth.header = clean(provider.auth.header || 'Authorization');
  provider.auth.scheme = scalarText(provider.auth.scheme === undefined ? 'Bearer' : provider.auth.scheme).trim();
  provider.auth.query_param = clean(provider.auth.query_param || 'key');
  provider.response_text_path = clean(provider.response_text_path || '');
  provider.response_json_path = clean(provider.response_json_path || '');
  provider.structured_output_mode = clean(provider.structured_output_mode || 'json_schema').toLowerCase();
  if (!['json_schema', 'json_object', 'prompt_only'].includes(provider.structured_output_mode)) provider.structured_output_mode = 'json_schema';
  provider.thinking = provider.thinking && typeof provider.thinking === 'object' && !Array.isArray(provider.thinking)
    ? { ...provider.thinking }
    : null;
  provider.extra_body = provider.extra_body && typeof provider.extra_body === 'object' && !Array.isArray(provider.extra_body)
    ? { ...provider.extra_body }
    : null;
  provider.request_body_template = provider.request_body_template && typeof provider.request_body_template === 'object'
    ? provider.request_body_template
    : null;
  provider.enabled = (() => {
    const value = clean(provider.enabled).toLowerCase();
    if (provider.enabled === undefined || value === 'auto') {
      const authReady = provider.auth.type === 'none' || Boolean(provider.api_key);
      const modelReady = ['generic_json', 'gemini_generate_content'].includes(provider.protocol) || Boolean(provider.model);
      return Boolean(provider.endpoint && modelReady && authReady);
    }
    return boolLike(provider.enabled, false);
  })();
  const modelReady = ['generic_json', 'gemini_generate_content'].includes(provider.protocol) || Boolean(provider.model);
  provider.configured = Boolean(provider.enabled && provider.endpoint && modelReady);
  provider.base_dir = baseDir;
  return provider;
}

function mergeSemanticRegionResolverConfig(config, configFile, outDir) {
  const baseDir = configFile ? path.dirname(configFile) : process.cwd();
  const task = config && config.semantic_region_resolver && typeof config.semantic_region_resolver === 'object'
    ? { ...config.semantic_region_resolver }
    : {};
  const localConfigFile = resolveConfigPathMaybe(
    task.local_config_file || config.semantic_region_resolver_local_config || 'config/local/semantic_model.local.json',
    baseDir,
  );
  const localRaw = readJsonIfExists(localConfigFile);
  const local = localRaw && typeof localRaw === 'object' && !Array.isArray(localRaw)
    ? (localRaw.semantic_region_resolver && typeof localRaw.semantic_region_resolver === 'object'
      ? { ...localRaw.semantic_region_resolver }
      : { ...localRaw })
    : {};

  const merged = deepMerge(local, task);
  merged.local_config_file = localConfigFile;
  merged.provider_order = normalizeProviderOrder(merged.provider_order);

  merged.codex_exec = deepMerge({
    enabled: 'auto',
    command: 'codex',
    model: '',
    reasoning_effort: '',
    profile: '',
    sandbox: 'read-only',
    skip_git_repo_check: true,
    timeout_ms: 90000,
    preflight_timeout_ms: 12000,
    probe_version: true,
    require_login_status: true,
    diagnostic_file: '',
    schema_file: 'assets/semantic_region_output.schema.json',
    working_directory: process.cwd(),
    temp_dir: path.join(outDir || process.cwd(), 'semantic_codex_temp'),
  }, merged.codex_exec || {});
  merged.codex_exec.command = clean(merged.codex_exec.command || 'codex');
  merged.codex_exec.candidates = discoverCodexCandidates(merged.codex_exec.command, baseDir);
  merged.codex_exec.usable_candidates = merged.codex_exec.candidates.filter((item) => !item.rejected);
  merged.codex_exec.resolved_command = merged.codex_exec.usable_candidates[0]?.path || '';
  merged.codex_exec.selected_candidate = null;
  merged.codex_exec.model = clean(merged.codex_exec.model || '');
  merged.codex_exec.reasoning_effort = clean(merged.codex_exec.reasoning_effort || '').toLowerCase();
  merged.codex_exec.profile = clean(merged.codex_exec.profile || '');
  merged.codex_exec.sandbox = clean(merged.codex_exec.sandbox || 'read-only').toLowerCase();
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(merged.codex_exec.sandbox)) merged.codex_exec.sandbox = 'read-only';
  merged.codex_exec.skip_git_repo_check = boolLike(merged.codex_exec.skip_git_repo_check, true);
  merged.codex_exec.timeout_ms = numberInRange(merged.codex_exec.timeout_ms, 90000, 5000, 600000);
  merged.codex_exec.preflight_timeout_ms = numberInRange(merged.codex_exec.preflight_timeout_ms, 12000, 2000, 60000);
  merged.codex_exec.schema_file = resolveConfigPathMaybe(merged.codex_exec.schema_file || 'assets/semantic_region_output.schema.json', baseDir);
  merged.codex_exec.working_directory = resolveConfigPathMaybe(merged.codex_exec.working_directory || process.cwd(), baseDir) || process.cwd();
  merged.codex_exec.temp_dir = resolveConfigPathMaybe(merged.codex_exec.temp_dir || path.join(outDir || process.cwd(), 'semantic_codex_temp'), baseDir);
  merged.codex_exec.diagnostic_file = resolveConfigPathMaybe(
    merged.codex_exec.diagnostic_file || path.join(outDir || process.cwd(), 'semantic_codex_diagnostic.json'),
    baseDir,
  );
  merged.codex_exec.require_login_status = boolLike(merged.codex_exec.require_login_status, true);
  merged.codex_exec.probe_version = boolLike(merged.codex_exec.probe_version, true);
  const codexEnabledRaw = clean(merged.codex_exec.enabled).toLowerCase();
  merged.codex_exec.enabled = merged.codex_exec.enabled === undefined || codexEnabledRaw === 'auto'
    ? Boolean(merged.codex_exec.usable_candidates.length)
    : boolLike(merged.codex_exec.enabled, false);
  merged.codex_exec.available = Boolean(merged.codex_exec.enabled && merged.codex_exec.usable_candidates.length);
  merged.codex_exec.display_model = merged.codex_exec.model || 'codex_cli_default';
  persistCodexDiagnostic(merged.codex_exec, {
    discovery: {
      status: merged.codex_exec.available ? 'candidate_detected_pending_preflight' : 'no_background_safe_cli_candidate',
      usable_candidate_count: merged.codex_exec.usable_candidates.length,
      windowsapps_alias_rejected: merged.codex_exec.candidates.some((item) => item.rejection_reason === 'windowsapps_app_execution_alias_not_background_safe'),
      note: 'The current Codex desktop conversation is not callable by the background collector. A standalone background-safe Codex CLI must pass version, login, and schema-output checks. The legacy global CODEX_CLI_PATH variable is ignored and stripped from child processes because it can interfere with the desktop app; use PATH, codex_exec.command, or FB_MONITOR_CODEX_CLI_PATH instead.',
    },
  });

  const localApiProviders = Array.isArray(local.api_providers) ? local.api_providers : [];
  const taskHasApiProviders = Object.prototype.hasOwnProperty.call(task, 'api_providers');
  const rawApiProviders = taskHasApiProviders
    ? (Array.isArray(task.api_providers) ? task.api_providers : [])
    : (Array.isArray(merged.api_providers) ? merged.api_providers : localApiProviders);
  merged.api_providers = rawApiProviders.map((item, index) => normalizeApiProvider(item, baseDir, index));

  const rawEnabled = Object.prototype.hasOwnProperty.call(task, 'enabled') ? task.enabled : local.enabled;
  const normalizedEnabled = clean(rawEnabled).toLowerCase();
  const hasConfiguredApi = merged.api_providers.some((item) => item.configured);
  if (rawEnabled === undefined || normalizedEnabled === 'auto') {
    merged.enabled = Boolean(merged.codex_exec.available || hasConfiguredApi);
    merged.enable_source = hasConfiguredApi
      ? 'auto_custom_api_configured'
      : (merged.codex_exec.available ? 'auto_codex_exec_available' : 'disabled_no_model_provider');
  } else {
    merged.enabled = boolLike(rawEnabled, false);
    merged.enable_source = Object.prototype.hasOwnProperty.call(task, 'enabled') ? 'task_config_explicit' : 'local_config_explicit';
  }

  merged.trigger_mode = clean(merged.trigger_mode || 'risk_only').toLowerCase();
  if (!['risk_only', 'all_unresolved'].includes(merged.trigger_mode)) merged.trigger_mode = 'risk_only';
  merged.confidence_threshold = numberInRange(merged.confidence_threshold, 0.85, 0.5, 1);
  merged.max_calls_per_run = numberInRange(merged.max_calls_per_run, 500, 0, 100000);
  merged.fail_closed_on_low_confidence = boolLike(merged.fail_closed_on_low_confidence, true);
  merged.fail_closed_on_error = boolLike(merged.fail_closed_on_error, true);
  merged.allow_model_explicit_region_lock = boolLike(merged.allow_model_explicit_region_lock, true);
  // V6.6.1 fixed policy: any low-confidence API result must continue to the
  // next provider and ultimately Codex. Legacy/private local files that still
  // contain false are intentionally overridden at runtime.
  merged.fallback_on_low_confidence = true;
  merged.fallback_on_low_confidence_source = 'v6.6.1_forced_api_to_codex_fallback';
  merged.cache_file = resolveConfigPathMaybe(
    merged.cache_file || path.join(outDir || process.cwd(), 'semantic_region_cache.json'),
    baseDir,
  );
  merged.provider_priority = merged.provider_order.join(' > ');
  merged.model = merged.api_providers.find((item) => item.configured)?.model
    || (merged.codex_exec.available ? merged.codex_exec.display_model : '');
  return merged;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function requestJson({ endpoint, apiKey, auth, headers, query, payload, timeoutMs }) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(endpoint);
      for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
      }
      if (auth?.type === 'query' && apiKey) url.searchParams.set(auth.query_param || 'key', apiKey);
    } catch (err) {
      resolve({ ok: false, status: 'endpoint_error', reason: err.message || String(err) });
      return;
    }
    const client = url.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...normalizeHeaders(headers),
    };
    if (auth?.type !== 'none' && auth?.type !== 'query' && apiKey) {
      const prefix = auth?.scheme ? `${auth.scheme} ` : '';
      requestHeaders[auth?.header || 'Authorization'] = `${prefix}${apiKey}`;
    }
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      method: 'POST',
      path: `${url.pathname}${url.search}`,
      headers: requestHeaders,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch (err) {
          resolve({ ok: false, status: 'parse_error', reason: err.message || String(err), http_status: res.statusCode, raw: raw.slice(0, 2000) });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({
            ok: false,
            status: 'http_error',
            reason: clean(json?.error?.message || json?.message || `HTTP ${res.statusCode}`),
            http_status: res.statusCode,
            json,
          });
          return;
        }
        resolve({ ok: true, status: 'ok', http_status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('semantic model request timeout')));
    req.on('error', (err) => {
      const message = err && err.message ? err.message : String(err);
      resolve({ ok: false, status: /timeout/i.test(message) ? 'timeout' : 'network_error', reason: message });
    });
    req.write(body);
    req.end();
  });
}

function isTransientFailure(response) {
  if (!response || response.ok) return false;
  if (['network_error', 'timeout', 'parse_error'].includes(response.status)) return true;
  if (response.status === 'http_error') {
    const code = Number(response.http_status || 0);
    return code === 408 || code === 425 || code === 429 || code >= 500;
  }
  return false;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location_intent: { type: 'string', enum: ['location', 'non_location', 'ambiguous'] },
    candidate_places: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    explicit_regions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    scope: { type: 'string', enum: ['single_region', 'multi_region', 'global', 'unknown'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', maxLength: 500 },
  },
  required: ['location_intent', 'candidate_places', 'explicit_regions', 'scope', 'confidence', 'reason'],
};

function buildPromptParts(context) {
  const schemaText = JSON.stringify(OUTPUT_SCHEMA);
  const systemText = [
    'You are a constrained semantic gate for Facebook game-group region detection.',
    'Do not decide the final normalized region and do not invent a location.',
    'Classify whether the residual group-name wording expresses a real geographic place, a non-location community/brand/action meaning, or remains ambiguous.',
    'candidate_places may only contain place phrases supported by the supplied original text.',
    'explicit_regions may only repeat explicit country, region, or uppercase geographic codes present in the supplied text.',
    'Use multi_region or global when the group explicitly covers several regions or the whole world.',
    'Return only one valid JSON object. Do not return Markdown, prose outside JSON, or code fences.',
    `The output JSON must conform exactly to this JSON Schema: ${schemaText}`,
  ].join(' ');
  const userObject = {
    task: 'semantic_region_gate',
    output_format: 'JSON',
    output_json_schema: OUTPUT_SCHEMA,
    group_name: clean(context.groupName),
    residual_group_name: clean(context.residualGroupName),
    about_location: clean(context.aboutLocationText),
    trigger_reason: clean(context.triggerReason),
    risk_terms: Array.isArray(context.riskTerms) ? context.riskTerms.slice(0, 20) : [],
    safe_geonames_queries: Array.isArray(context.safeQueries) ? context.safeQueries.slice(0, 8) : [],
    deterministic_region_evidence: Array.isArray(context.deterministicEvidence) ? context.deterministicEvidence.slice(0, 12) : [],
  };
  return { systemText, userText: JSON.stringify(userObject) };
}

function buildCodexPrompt(context) {
  const { systemText, userText } = buildPromptParts(context);
  return `${systemText}\n\nInput JSON:\n${userText}`;
}

function deepTemplate(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => deepTemplate(item, replacements));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = deepTemplate(child, replacements);
    return output;
  }
  if (typeof value !== 'string') return value;
  if (Object.prototype.hasOwnProperty.call(replacements, value)) return replacements[value];
  let text = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    if (typeof replacement === 'string' || typeof replacement === 'number' || typeof replacement === 'boolean') {
      text = text.split(token).join(String(replacement));
    }
  }
  return text;
}

function applyProviderPayloadExtensions(provider, payload) {
  // Provider-specific extra fields are allowed, but the resolver's required
  // model/messages/JSON-output controls win on conflicts.
  let output = provider.extra_body ? deepMerge(provider.extra_body, payload) : payload;
  if (provider.thinking) output.thinking = { ...provider.thinking };
  return output;
}

function buildApiPayload(provider, context) {
  const { systemText, userText } = buildPromptParts(context);
  const protocol = provider.protocol;
  if (protocol === 'openai_responses') {
    const payload = {
      model: provider.model,
      store: false,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemText }] },
        { role: 'user', content: [{ type: 'input_text', text: userText }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'semantic_region_gate',
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
      max_output_tokens: provider.max_output_tokens,
    };
    if (provider.reasoning_effort) payload.reasoning = { effort: provider.reasoning_effort };
    return applyProviderPayloadExtensions(provider, payload);
  }
  if (protocol === 'openai_chat_completions') {
    const payload = {
      model: provider.model,
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText },
      ],
      max_tokens: provider.max_output_tokens,
    };
    if (provider.structured_output_mode === 'json_schema') {
      payload.response_format = {
        type: 'json_schema',
        json_schema: { name: 'semantic_region_gate', strict: true, schema: OUTPUT_SCHEMA },
      };
    } else if (provider.structured_output_mode === 'json_object') {
      payload.response_format = { type: 'json_object' };
    }
    return applyProviderPayloadExtensions(provider, payload);
  }
  if (protocol === 'anthropic_messages') {
    const payload = {
      model: provider.model,
      max_tokens: provider.max_output_tokens,
      system: systemText,
      messages: [{ role: 'user', content: userText }],
      tools: [{ name: 'semantic_region_gate', description: 'Return the semantic region gate decision as JSON.', input_schema: OUTPUT_SCHEMA }],
      tool_choice: { type: 'tool', name: 'semantic_region_gate' },
    };
    return applyProviderPayloadExtensions(provider, payload);
  }
  if (protocol === 'gemini_generate_content') {
    const payload = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: OUTPUT_SCHEMA,
        maxOutputTokens: provider.max_output_tokens,
      },
    };
    return applyProviderPayloadExtensions(provider, payload);
  }
  const template = provider.request_body_template || {
    model: '{{MODEL}}',
    system: '{{SYSTEM_PROMPT}}',
    input: '{{USER_PROMPT}}',
    schema: '{{JSON_SCHEMA}}',
    max_output_tokens: '{{MAX_OUTPUT_TOKENS}}',
  };
  return applyProviderPayloadExtensions(provider, deepTemplate(template, {
    '{{MODEL}}': provider.model,
    '{{SYSTEM_PROMPT}}': systemText,
    '{{USER_PROMPT}}': userText,
    '{{JSON_SCHEMA}}': OUTPUT_SCHEMA,
    '{{MAX_OUTPUT_TOKENS}}': provider.max_output_tokens,
  }));
}

function extractOpenAIResponses(json) {
  if (!json || typeof json !== 'object') return { text: '', refusal: '' };
  if (typeof json.output_text === 'string' && json.output_text.trim()) return { text: json.output_text.trim(), refusal: '' };
  let refusal = '';
  const texts = [];
  for (const item of (Array.isArray(json.output) ? json.output : [])) {
    for (const content of (Array.isArray(item?.content) ? item.content : [])) {
      if (content?.type === 'output_text' && typeof content.text === 'string') texts.push(content.text);
      if (content?.type === 'refusal') refusal = clean(content.refusal || content.text || 'model_refusal');
    }
  }
  return { text: texts.join('\n').trim(), refusal };
}

function extractApiDecision(provider, json) {
  if (provider.response_json_path) {
    const value = getByPath(json, provider.response_json_path);
    if (value && typeof value === 'object') return { decision: value, text: '', refusal: '' };
  }
  if (provider.protocol === 'openai_responses') return extractOpenAIResponses(json);
  if (provider.protocol === 'openai_chat_completions') {
    const content = getByPath(json, provider.response_text_path || 'choices.0.message.content');
    return { text: clean(content), refusal: '' };
  }
  if (provider.protocol === 'anthropic_messages') {
    const content = Array.isArray(json?.content) ? json.content : [];
    const toolUse = content.find((item) => item?.type === 'tool_use' && item?.name === 'semantic_region_gate');
    if (toolUse?.input && typeof toolUse.input === 'object') return { decision: toolUse.input, text: '', refusal: '' };
    const text = content.filter((item) => item?.type === 'text').map((item) => clean(item.text)).filter(Boolean).join('\n');
    return { text, refusal: '' };
  }
  if (provider.protocol === 'gemini_generate_content') {
    const text = getByPath(json, provider.response_text_path || 'candidates.0.content.parts.0.text');
    return { text: clean(text), refusal: '' };
  }
  const value = provider.response_text_path ? getByPath(json, provider.response_text_path) : json;
  if (value && typeof value === 'object') return { decision: value, text: '', refusal: '' };
  return { text: clean(value), refusal: '' };
}

function normalizeForSupportCheck(value) {
  return clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return normalizeForSupportCheck(value).split(/\s+/).filter(Boolean);
}

function phraseSupportedBySource(phrase, sourceText) {
  const rawPhrase = clean(phrase);
  const rawSource = clean(sourceText);
  if (/^[A-Z]{2,3}$/.test(rawPhrase)) {
    const escaped = rawPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z])${escaped}(?=$|[^A-Za-z])`).test(rawSource);
  }
  const phraseWords = words(rawPhrase);
  const sourceWords = new Set(words(rawSource));
  if (!phraseWords.length) return false;
  return phraseWords.every((word) => sourceWords.has(word));
}

function validateDecision(raw, context) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'decision_not_object' };
  const locationIntent = clean(raw.location_intent).toLowerCase();
  const scope = clean(raw.scope).toLowerCase();
  if (!['location', 'non_location', 'ambiguous'].includes(locationIntent)) return { ok: false, reason: 'invalid_location_intent' };
  if (!['single_region', 'multi_region', 'global', 'unknown'].includes(scope)) return { ok: false, reason: 'invalid_scope' };
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { ok: false, reason: 'invalid_confidence' };

  const sourceText = [context.groupName, context.residualGroupName, context.aboutLocationText].filter(Boolean).join(' ');
  const candidatePlaces = Array.from(new Set((Array.isArray(raw.candidate_places) ? raw.candidate_places : [])
    .map(clean)
    .filter((item) => item && phraseSupportedBySource(item, sourceText))))
    .slice(0, 4);
  const explicitRegions = Array.from(new Set((Array.isArray(raw.explicit_regions) ? raw.explicit_regions : [])
    .map(clean)
    .filter((item) => item && phraseSupportedBySource(item, sourceText))))
    .slice(0, 6);

  return {
    ok: true,
    decision: {
      location_intent: locationIntent,
      candidate_places: candidatePlaces,
      explicit_regions: explicitRegions,
      scope,
      confidence,
      reason: clean(raw.reason).slice(0, 500),
    },
  };
}

function parseDecisionFromExtraction(extracted, context) {
  if (extracted?.refusal) return { ok: false, status: 'refusal', reason: extracted.refusal };
  let parsed = extracted?.decision;
  if (!parsed) {
    try {
      parsed = JSON.parse(clean(extracted?.text));
    } catch (err) {
      return { ok: false, status: 'invalid_json', reason: err.message || String(err) };
    }
  }
  const validated = validateDecision(parsed, context);
  if (!validated.ok) return { ok: false, status: 'schema_validation_failed', reason: validated.reason };
  return { ok: true, decision: validated.decision };
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    } else {
      child.kill('SIGKILL');
    }
  } catch (_err) {
    // Best effort only.
  }
}

function spawnCapture(command, args, { cwd, input, timeoutMs, maxOutputBytes = 2 * 1024 * 1024, shell = false }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: cwd || process.cwd(),
        shell: Boolean(shell),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironmentWithoutLegacyCodexOverride(),
      });
    } catch (err) {
      resolve({ ok: false, status: 'spawn_error', reason: err.message || String(err) });
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < maxOutputBytes) {
        stdout.push(chunk);
        stdoutBytes += chunk.length;
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderrBytes < maxOutputBytes) {
        stderr.push(chunk);
        stderrBytes += chunk.length;
      }
    });
    child.on('error', (err) => finish({ ok: false, status: 'process_error', reason: err.message || String(err) }));
    child.on('close', (code, signal) => finish({
      ok: code === 0,
      status: code === 0 ? 'ok' : 'process_exit_error',
      exit_code: code,
      signal: signal || '',
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      reason: code === 0 ? '' : clean(Buffer.concat(stderr).toString('utf8') || `process exited with code ${code}`),
    }));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input || '');
    }
    timer = setTimeout(() => {
      killProcessTree(child);
      finish({ ok: false, status: 'timeout', reason: `process timeout after ${timeoutMs}ms` });
    }, timeoutMs);
  });
}


function spawnCaptureCandidate(candidate, args, options) {
  const launch = buildCandidateLaunch(candidate, args);
  if (!launch) {
    return Promise.resolve({ ok: false, status: 'invalid_candidate', reason: candidate?.rejection_reason || 'invalid Codex CLI candidate' });
  }
  return spawnCapture(launch.command, launch.args, { ...options, shell: launch.shell });
}

function safeCodexCandidateForDiagnostic(candidate) {
  if (!candidate) return null;
  return {
    path: candidate.path,
    source: candidate.source,
    kind: candidate.kind,
    exists: candidate.exists,
    rejected: candidate.rejected,
    rejection_reason: candidate.rejection_reason,
    size_bytes: candidate.size_bytes,
  };
}

function persistCodexDiagnostic(config, payload) {
  try {
    if (!config?.diagnostic_file) return;
    writeJsonAtomic(config.diagnostic_file, {
      diagnostic_kind: 'facebook_group_monitor_codex_exec',
      version: '6.6.1',
      updated_at: new Date().toISOString(),
      requested_command: config.command,
      environment_safety: {
        legacy_global_codex_cli_path_detected: hasEnvironmentVariableCaseInsensitive(LEGACY_GLOBAL_CODEX_ENV),
        legacy_global_codex_cli_path_ignored: true,
        private_skill_override_name: PRIVATE_SKILL_CODEX_ENV,
        private_skill_override_detected: hasEnvironmentVariableCaseInsensitive(PRIVATE_SKILL_CODEX_ENV),
        child_processes_strip_legacy_global_override: true,
      },
      candidates: (config.candidates || []).map(safeCodexCandidateForDiagnostic),
      selected_candidate: safeCodexCandidateForDiagnostic(config.selected_candidate),
      ...payload,
    });
  } catch (_err) {
    // Diagnostic persistence must never stop collection.
  }
}

async function ensureCodexPreflight(config, stats) {
  if (config._preflight_result) return config._preflight_result;
  const candidates = Array.isArray(config.usable_candidates) ? config.usable_candidates : [];
  if (!config.enabled || !candidates.length) {
    const result = {
      ok: false,
      status: (config.candidates || []).some((item) => item.rejection_reason === 'windowsapps_app_execution_alias_not_background_safe')
        ? 'windowsapps_alias_only'
        : 'command_missing',
      reason: (config.candidates || []).some((item) => item.rejection_reason === 'windowsapps_app_execution_alias_not_background_safe')
        ? 'Only a Microsoft WindowsApps Codex app-execution alias was found. This alias is not a background-safe Codex CLI executable.'
        : `No usable Codex CLI executable found for: ${config.command}`,
      attempts: [],
    };
    config._preflight_result = result;
    persistCodexDiagnostic(config, { preflight: result });
    return result;
  }

  const attempts = [];
  for (const candidate of candidates) {
    const attempt = { candidate: safeCodexCandidateForDiagnostic(candidate) };
    if (config.probe_version) {
      const versionResult = await spawnCaptureCandidate(candidate, ['--version'], {
        cwd: config.working_directory,
        input: '',
        timeoutMs: config.preflight_timeout_ms,
        maxOutputBytes: 256 * 1024,
      });
      attempt.version = {
        ok: versionResult.ok,
        status: versionResult.status,
        exit_code: versionResult.exit_code,
        stdout: clean(versionResult.stdout || '').slice(0, 500),
        stderr: clean(versionResult.stderr || '').slice(0, 500),
        reason: clean(versionResult.reason || '').slice(0, 500),
      };
      if (!versionResult.ok) {
        attempts.push(attempt);
        if (stats) stats.semantic_region_codex_exec_candidate_failures = (stats.semantic_region_codex_exec_candidate_failures || 0) + 1;
        continue;
      }
    }

    if (config.require_login_status) {
      const loginResult = await spawnCaptureCandidate(candidate, ['login', 'status'], {
        cwd: config.working_directory,
        input: '',
        timeoutMs: config.preflight_timeout_ms,
        maxOutputBytes: 256 * 1024,
      });
      attempt.login = {
        ok: loginResult.ok,
        status: loginResult.status,
        exit_code: loginResult.exit_code,
        stdout: clean(loginResult.stdout || '').slice(0, 1000),
        stderr: clean(loginResult.stderr || '').slice(0, 1000),
        reason: clean(loginResult.reason || '').slice(0, 1000),
      };
      if (!loginResult.ok) {
        attempts.push(attempt);
        if (stats) stats.semantic_region_codex_exec_candidate_failures = (stats.semantic_region_codex_exec_candidate_failures || 0) + 1;
        continue;
      }
    }

    config.selected_candidate = candidate;
    config.resolved_command = candidate.path;
    const result = {
      ok: true,
      status: 'ok',
      reason: clean(attempt.login?.stdout || attempt.version?.stdout || ''),
      selected_candidate: safeCodexCandidateForDiagnostic(candidate),
      attempts: [...attempts, attempt],
    };
    config._preflight_result = result;
    if (stats) stats.semantic_region_codex_exec_preflight_ok = (stats.semantic_region_codex_exec_preflight_ok || 0) + 1;
    persistCodexDiagnostic(config, { preflight: result });
    return result;
  }

  const accessDenied = attempts.some((item) => /access is denied|eacces|eperm/i.test([
    item.version?.reason,
    item.version?.stderr,
    item.login?.reason,
    item.login?.stderr,
  ].filter(Boolean).join(' ')));
  const result = {
    ok: false,
    status: accessDenied ? 'codex_cli_access_denied' : 'codex_cli_preflight_failed',
    reason: accessDenied
      ? 'All discovered Codex CLI candidates failed to start with Access is denied. Keep the standalone CLI on PATH, set semantic_region_resolver.codex_exec.command in the Skill local config, or use FB_MONITOR_CODEX_CLI_PATH for this Skill only. Do not set the global CODEX_CLI_PATH variable.'
      : 'No discovered Codex CLI candidate passed version and login checks.',
    attempts,
  };
  config._preflight_result = result;
  persistCodexDiagnostic(config, { preflight: result });
  return result;
}

async function runCodexProvider(config, context, stats) {
  if (!config.enabled || !config.available) {
    const onlyAlias = (config.candidates || []).some((item) => item.rejection_reason === 'windowsapps_app_execution_alias_not_background_safe');
    return {
      ok: false,
      status: onlyAlias ? 'windowsapps_alias_only' : 'command_missing',
      reason: onlyAlias
        ? 'Codex desktop app alias detected, but no background-safe Codex CLI was found.'
        : `Codex CLI not found: ${config.command}`,
    };
  }
  const preflight = await ensureCodexPreflight(config, stats);
  if (!preflight.ok) return preflight;
  const candidate = config.selected_candidate;
  if (!candidate) return { ok: false, status: 'no_selected_candidate', reason: 'Codex CLI preflight did not select an executable.' };

  const tempDir = path.resolve(config.temp_dir || path.join(process.cwd(), 'semantic_codex_temp'));
  fs.mkdirSync(tempDir, { recursive: true });
  const outputFile = path.join(tempDir, `semantic-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
  const args = ['exec'];
  if (config.skip_git_repo_check) args.push('--skip-git-repo-check');
  args.push('--sandbox', config.sandbox || 'read-only');
  args.push('--color', 'never');
  if (config.schema_file) args.push('--output-schema', config.schema_file);
  args.push('--output-last-message', outputFile);
  if (config.model) args.push('--model', config.model);
  if (config.profile) args.push('--profile', config.profile);
  if (config.reasoning_effort) args.push('--config', `model_reasoning_effort=${config.reasoning_effort}`);
  args.push('-');

  if (stats) stats.semantic_region_codex_exec_requests = (stats.semantic_region_codex_exec_requests || 0) + 1;
  const result = await spawnCaptureCandidate(candidate, args, {
    cwd: config.working_directory,
    input: buildCodexPrompt(context),
    timeoutMs: config.timeout_ms,
  });
  let outputText = '';
  try {
    if (fs.existsSync(outputFile)) outputText = fs.readFileSync(outputFile, 'utf8').replace(/^\uFEFF/, '').trim();
  } catch (_err) {
    // Fall back to stdout.
  }
  try { fs.rmSync(outputFile, { force: true }); } catch (_err) {}
  if (!result.ok) {
    if (stats) stats.semantic_region_codex_exec_errors = (stats.semantic_region_codex_exec_errors || 0) + 1;
    const failure = {
      ok: false,
      status: result.status,
      reason: clean(result.reason || result.stderr || result.stdout),
      provider: 'codex_exec',
      model: config.display_model,
      exit_code: result.exit_code,
      selected_candidate: safeCodexCandidateForDiagnostic(candidate),
    };
    persistCodexDiagnostic(config, { preflight, last_exec: failure });
    return failure;
  }
  const parsed = parseDecisionFromExtraction({ text: outputText || result.stdout }, context);
  if (!parsed.ok) {
    if (stats) stats.semantic_region_codex_exec_errors = (stats.semantic_region_codex_exec_errors || 0) + 1;
    const failure = {
      ok: false,
      status: parsed.status,
      reason: parsed.reason,
      provider: 'codex_exec',
      model: config.display_model,
      selected_candidate: safeCodexCandidateForDiagnostic(candidate),
    };
    persistCodexDiagnostic(config, { preflight, last_exec: failure });
    return failure;
  }
  const success = {
    ok: true,
    decision: parsed.decision,
    provider: 'codex_exec',
    model: config.display_model,
    endpoint: candidate.path,
    selected_candidate: safeCodexCandidateForDiagnostic(candidate),
  };
  persistCodexDiagnostic(config, {
    preflight,
    last_exec: {
      ok: true,
      status: 'schema_output_verified',
      selected_candidate: safeCodexCandidateForDiagnostic(candidate),
      verified_at: new Date().toISOString(),
    },
  });
  return success;
}

async function requestApiWithRetry(provider, context, stats) {
  const payload = buildApiPayload(provider, context);
  const attempts = 1 + Math.max(0, Number(provider.retry_count || 0));
  let response = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    response = await requestJson({
      endpoint: provider.endpoint,
      apiKey: provider.api_key,
      auth: provider.auth,
      headers: provider.headers,
      query: provider.query,
      payload,
      timeoutMs: provider.timeout_ms,
    });
    if (response.ok || !isTransientFailure(response) || attempt >= attempts) break;
    if (stats) stats.semantic_region_retries = (stats.semantic_region_retries || 0) + 1;
    await sleepMs(Number(provider.retry_backoff_ms || 1200) * attempt);
  }
  return response;
}

async function runApiProvider(provider, context, stats) {
  if (!provider.configured) return { ok: false, status: 'api_not_configured', reason: `API provider ${provider.name} is not configured` };
  if (stats) stats.semantic_region_custom_api_requests = (stats.semantic_region_custom_api_requests || 0) + 1;
  const response = await requestApiWithRetry(provider, context, stats);
  if (!response.ok) {
    if (stats) stats.semantic_region_custom_api_errors = (stats.semantic_region_custom_api_errors || 0) + 1;
    return {
      ok: false,
      status: response.status || 'request_error',
      reason: clean(response.reason || ''),
      http_status: response.http_status || '',
      provider: `custom_api:${provider.name}`,
      model: provider.model,
      endpoint: provider.endpoint,
    };
  }
  const parsed = parseDecisionFromExtraction(extractApiDecision(provider, response.json), context);
  if (!parsed.ok) {
    if (stats) stats.semantic_region_custom_api_errors = (stats.semantic_region_custom_api_errors || 0) + 1;
    return {
      ok: false,
      status: parsed.status,
      reason: parsed.reason,
      provider: `custom_api:${provider.name}`,
      model: provider.model,
      endpoint: provider.endpoint,
    };
  }
  await sleepMs(provider.rate_limit_ms);
  return {
    ok: true,
    decision: parsed.decision,
    provider: `custom_api:${provider.name}`,
    model: provider.model,
    endpoint: provider.endpoint,
    protocol: provider.protocol,
  };
}

function providerFingerprint(config) {
  return {
    provider_order: config.provider_order,
    codex: {
      enabled: config.codex_exec.enabled,
      command: config.codex_exec.command,
      model: config.codex_exec.model,
      profile: config.codex_exec.profile,
    },
    apis: config.api_providers.map((item) => ({
      name: item.name,
      enabled: item.enabled,
      protocol: item.protocol,
      endpoint: item.endpoint,
      model: item.model,
      structured_output_mode: item.structured_output_mode,
      thinking: item.thinking || null,
      extra_body: item.extra_body || null,
      api_key_hint: maskSecret(item.api_key),
    })),
  };
}

function cacheKey(config, context) {
  const value = JSON.stringify({
    v: 'semantic-region-v6.6.1-api-first-deepseek-compatible',
    providers: providerFingerprint(config),
    group_name: clean(context.groupName),
    residual_group_name: clean(context.residualGroupName),
    about_location: clean(context.aboutLocationText),
    trigger_reason: clean(context.triggerReason),
    risk_terms: context.riskTerms || [],
    safe_queries: context.safeQueries || [],
  });
  return `semantic-region-v6.6.1-api-first-deepseek-compatible|${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function recordDecisionStats(out, stats) {
  if (!stats) return;
  if (out.status === 'low_confidence') stats.semantic_region_low_confidence = (stats.semantic_region_low_confidence || 0) + 1;
  else if (out.location_intent === 'non_location') stats.semantic_region_non_location = (stats.semantic_region_non_location || 0) + 1;
  else if (out.scope === 'multi_region' || out.scope === 'global') stats.semantic_region_multi_or_global = (stats.semantic_region_multi_or_global || 0) + 1;
  else if (out.location_intent === 'location') stats.semantic_region_location = (stats.semantic_region_location || 0) + 1;
  else stats.semantic_region_ambiguous = (stats.semantic_region_ambiguous || 0) + 1;
}

async function runSemanticRegionResolver({ config, cache, context, stats }) {
  if (!config || !config.enabled) {
    return {
      status: 'disabled',
      provider: 'rules_only',
      model: '',
      provider_chain: [],
      enable_source: config?.enable_source || '',
    };
  }
  if (stats && Number(stats.semantic_region_requests || 0) >= Number(config.max_calls_per_run || 0)) {
    if (stats) stats.semantic_region_rules_only_fallbacks = (stats.semantic_region_rules_only_fallbacks || 0) + 1;
    return {
      status: 'rules_only_fallback',
      provider: 'rules_only',
      model: '',
      provider_chain: ['run_call_limit'],
      fallback_reason: 'semantic model call limit reached',
    };
  }

  const key = cacheKey(config, context);
  const cached = cache ? cache.get(key) : null;
  if (cached) {
    if (stats) stats.semantic_region_cache_hits = (stats.semantic_region_cache_hits || 0) + 1;
    return { ...cached, cached: true };
  }

  if (stats) stats.semantic_region_requests = (stats.semantic_region_requests || 0) + 1;
  const providerChain = [];
  let lastFailure = null;

  for (const providerType of config.provider_order) {
    if (providerType === 'codex_exec') {
      if (!config.codex_exec.enabled) {
        providerChain.push('codex_exec:disabled');
        continue;
      }
      const result = await runCodexProvider(config.codex_exec, context, stats);
      if (result.ok) {
        const decision = result.decision;
        const out = {
          status: decision.confidence >= config.confidence_threshold ? 'accepted' : 'low_confidence',
          provider: result.provider,
          model: result.model,
          endpoint: result.endpoint,
          provider_chain: [...providerChain, 'codex_exec:accepted'],
          ...decision,
        };
        recordDecisionStats(out, stats);
        if (out.status === 'accepted' || !config.fallback_on_low_confidence) {
          if (cache) cache.set(key, out);
          return out;
        }
        providerChain.push('codex_exec:low_confidence');
        lastFailure = { status: 'low_confidence', reason: decision.reason };
        if (stats) stats.semantic_region_provider_fallbacks = (stats.semantic_region_provider_fallbacks || 0) + 1;
        continue;
      }
      providerChain.push(`codex_exec:${result.status}`);
      lastFailure = result;
      if (stats) stats.semantic_region_provider_fallbacks = (stats.semantic_region_provider_fallbacks || 0) + 1;
      continue;
    }

    if (providerType === 'custom_api') {
      const configuredProviders = config.api_providers.filter((item) => item.configured);
      if (!configuredProviders.length) {
        providerChain.push('custom_api:not_configured');
        continue;
      }
      for (const provider of configuredProviders) {
        const result = await runApiProvider(provider, context, stats);
        if (result.ok) {
          const decision = result.decision;
          const providerLabel = `custom_api:${provider.name}`;
          const out = {
            status: decision.confidence >= config.confidence_threshold ? 'accepted' : 'low_confidence',
            provider: providerLabel,
            model: result.model,
            endpoint: result.endpoint,
            protocol: result.protocol,
            provider_chain: [...providerChain, `${providerLabel}:accepted`],
            ...decision,
          };
          recordDecisionStats(out, stats);
          if (out.status === 'accepted' || !config.fallback_on_low_confidence) {
            if (cache) cache.set(key, out);
            return out;
          }
          providerChain.push(`${providerLabel}:low_confidence`);
          lastFailure = { status: 'low_confidence', reason: decision.reason };
          if (stats) stats.semantic_region_provider_fallbacks = (stats.semantic_region_provider_fallbacks || 0) + 1;
          continue;
        }
        providerChain.push(`custom_api:${provider.name}:${result.status}`);
        lastFailure = result;
        if (stats) stats.semantic_region_provider_fallbacks = (stats.semantic_region_provider_fallbacks || 0) + 1;
      }
      continue;
    }

    if (providerType === 'rules_only') break;
  }

  if (stats) stats.semantic_region_rules_only_fallbacks = (stats.semantic_region_rules_only_fallbacks || 0) + 1;
  return {
    status: 'rules_only_fallback',
    provider: 'rules_only',
    model: '',
    provider_chain: [...providerChain, 'rules_only'],
    fallback_reason: clean(lastFailure?.reason || lastFailure?.status || 'no usable semantic model provider'),
    reason: clean(lastFailure?.reason || ''),
  };
}

function semanticAuditFields(result) {
  const value = result || {};
  return {
    __semantic_provider: value.provider || '',
    __semantic_model: value.model || '',
    __semantic_status: value.status || '',
    __semantic_trigger: value.trigger_reason || '',
    __semantic_location_intent: value.location_intent || '',
    __semantic_scope: value.scope || '',
    __semantic_confidence: value.confidence === undefined || value.confidence === null ? '' : String(Number(value.confidence).toFixed(2)),
    __semantic_candidate_places: Array.isArray(value.candidate_places) ? value.candidate_places.join(' | ') : '',
    __semantic_explicit_regions: Array.isArray(value.explicit_regions) ? value.explicit_regions.join(' | ') : '',
    __semantic_reason: value.reason || '',
    __semantic_cached: value.cached ? 'yes' : 'no',
    __semantic_provider_chain: Array.isArray(value.provider_chain) ? value.provider_chain.join(' > ') : '',
    __semantic_fallback_reason: value.fallback_reason || '',
  };
}

module.exports = {
  OUTPUT_SCHEMA,
  SemanticRegionCache,
  mergeSemanticRegionResolverConfig,
  runSemanticRegionResolver,
  semanticAuditFields,
  ensureCodexPreflight,
  discoverCodexCandidates,
  buildCandidateLaunch,
  runCodexProvider,
};
