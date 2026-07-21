const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('./json_io');
const {
  mergeSemanticRegionResolverConfig,
  ensureCodexPreflight,
  runCodexProvider,
} = require('./semantic_region_resolver');

function argValue(name) {
  const index = process.argv.findIndex((item) => item === name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return {};
  return readJsonFile(file);
}

async function main() {
  const configFile = argValue('--config');
  const outDir = path.resolve(argValue('--out-dir') || path.join(process.cwd(), 'runs', 'semantic_diagnostic'));
  fs.mkdirSync(outDir, { recursive: true });
  const taskConfig = readJson(configFile);
  const config = mergeSemanticRegionResolverConfig(taskConfig, configFile || '', outDir);
  const stats = {};
  const preflight = await ensureCodexPreflight(config.codex_exec, stats);
  const report = {
    diagnostic_kind: 'facebook_group_monitor_codex_exec_manual_check',
    version: '6.6.1',
    checked_at: new Date().toISOString(),
    preflight,
    stats,
    smoke_test_requested: hasFlag('--smoke-test'),
  };

  if (preflight.ok && hasFlag('--smoke-test')) {
    report.smoke_test = await runCodexProvider(config.codex_exec, {
      groupName: 'Drama Ragnarok M Classic',
      residualGroupName: 'Drama',
      aboutLocationText: '',
      triggerReason: 'diagnostic_high_ambiguity_term',
      riskTerms: ['drama'],
      safeQueries: [],
      deterministicEvidence: [],
    }, stats);
    report.schema_output_verified = Boolean(report.smoke_test?.ok);
  } else {
    report.schema_output_verified = false;
  }

  const file = path.join(outDir, 'semantic_codex_manual_diagnostic.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Diagnostic file: ${file}\n`);
  if (!preflight.ok || (hasFlag('--smoke-test') && !report.schema_output_verified)) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
