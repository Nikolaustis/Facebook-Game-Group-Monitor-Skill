const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  SemanticRegionCache,
  mergeSemanticRegionResolverConfig,
  runSemanticRegionResolver,
} = require('./semantic_region_resolver');

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function clean(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const apiOnly = hasFlag('--api-only');
  const configFile = path.join(root, 'semantic_provider_diagnostic.task.json');
  const outDir = path.join(os.tmpdir(), `fb-semantic-diagnostic-${process.pid}-${Date.now()}`);
  const taskConfig = {
    semantic_region_resolver: {
      local_config_file: path.join(root, 'config', 'local', 'semantic_model.local.json'),
      cache_file: path.join(outDir, 'semantic_region_cache.json'),
      max_calls_per_run: 5,
      codex_exec: apiOnly ? { enabled: false } : {},
    },
  };
  const config = mergeSemanticRegionResolverConfig(taskConfig, configFile, outDir);
  const stats = {};
  const cache = new SemanticRegionCache(path.join(outDir, 'semantic_region_cache.json'));
  const result = await runSemanticRegionResolver({
    config,
    cache,
    stats,
    context: {
      groupName: 'Drama Ragnarok M Classic',
      residualGroupName: 'Drama',
      aboutLocationText: '',
      triggerReason: 'diagnostic_risk_term:drama',
      riskTerms: ['drama'],
      safeQueries: ['drama'],
      deterministicEvidence: [],
    },
  });

  const providerChain = Array.isArray(result.provider_chain) ? result.provider_chain : [];
  const configuredApiCount = config.api_providers.filter((item) => item.configured).length;
  const apiRequests = Number(stats.semantic_region_custom_api_requests || 0);
  const apiErrors = Number(stats.semantic_region_custom_api_errors || 0);
  const directApiDecision = String(result.provider || '').startsWith('custom_api:');
  const apiLowConfidenceFallback = providerChain.some((item) => /^custom_api:[^:]+:low_confidence$/.test(String(item)));
  const apiReturnedValidDecision = directApiDecision || apiLowConfidenceFallback;

  let verificationStatus = 'not_evaluated';
  let verificationOk = true;
  let verificationReason = '';
  if (apiOnly) {
    if (!configuredApiCount) {
      verificationOk = false;
      verificationStatus = 'api_not_configured';
      verificationReason = 'No configured custom API provider was available for the API-only diagnostic.';
    } else if (!apiRequests) {
      verificationOk = false;
      verificationStatus = 'api_not_invoked';
      verificationReason = 'A custom API was configured, but no API request was issued.';
    } else if (directApiDecision) {
      verificationStatus = 'api_decision_accepted';
      verificationReason = 'The API returned valid Schema output at or above the confidence threshold.';
    } else if (apiLowConfidenceFallback) {
      verificationStatus = 'api_valid_low_confidence_fallback';
      verificationReason = 'The API request and Schema parsing succeeded; the valid decision was below the confidence threshold and correctly continued to fallback.';
    } else {
      verificationOk = false;
      verificationStatus = apiErrors > 0 ? 'api_request_or_parse_failed' : 'api_no_valid_schema_decision';
      verificationReason = clean(result.fallback_reason || result.reason || 'The API did not produce a valid accepted or low-confidence Schema decision.');
    }
  }

  const report = {
    diagnostic_kind: 'facebook_group_monitor_semantic_provider_chain',
    version: '6.6.1',
    checked_at: new Date().toISOString(),
    mode: apiOnly ? 'api_only' : 'full_chain',
    provider_order: config.provider_order,
    configured_apis: config.api_providers.map((item) => ({
      name: item.name,
      configured: item.configured,
      protocol: item.protocol,
      endpoint: item.endpoint,
      model: item.model,
      structured_output_mode: item.structured_output_mode,
      thinking: item.thinking || null,
    })),
    fallback_on_low_confidence: config.fallback_on_low_confidence,
    fallback_on_low_confidence_source: config.fallback_on_low_confidence_source,
    verification: {
      ok: verificationOk,
      status: verificationStatus,
      reason: verificationReason,
      configured_api_count: configuredApiCount,
      api_requests: apiRequests,
      api_errors: apiErrors,
      api_returned_valid_decision: apiReturnedValidDecision,
      low_confidence_fallback_observed: apiLowConfidenceFallback,
    },
    result,
    stats,
  };
  const reportFile = path.join(root, 'semantic_provider_diagnostic.json');
  writeJsonAtomic(reportFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Diagnostic written to: ${reportFile}\n`);
  if (apiOnly && !verificationOk) process.exitCode = 2;
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
