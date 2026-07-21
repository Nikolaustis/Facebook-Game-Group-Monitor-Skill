# Facebook Group Monitor Skill V6.6.0

V6.6.0 is a cumulative Windows-oriented Facebook game-group monitoring package. It preserves the uploaded base package workbook field order and adds resilient JSON input handling, phase-2 input preflight, verified startup health, and a standard retryable handoff workflow for “run this second batch after the current Facebook task finishes”.

## Main workflow

1. Phase 1 collects group candidates and source-query metadata.
2. Phase 2 prefilters candidate names before opening About and discussion pages.
3. Target titles, aliases, controlled variants, sibling games, and IP-root-only matches are evaluated separately.
4. Language and region use deterministic evidence first, then configured APIs, verified Codex CLI, local rules, and controlled GeoNames.
5. A complete checkpoint is saved after every candidate.
6. `detail` and `manual_review` use the workbook field order supplied in the uploaded base package.
7. Chrome closes after verified finalization. Scheduled tasks delete themselves. Shutdown remains prompt-driven and defaults to disabled.

## V6.6.0 reliability changes

### BOM-safe JSON inputs

Core JSON readers now accept:

- UTF-8 without BOM;
- UTF-8 with BOM;
- UTF-16 LE/BE with BOM;
- strongly detected UTF-16 LE input without BOM.

This applies to phase-1 configuration, phase-2 index/config/candidate files, shutdown policy, checkpoints, semantic configuration, and login-state configuration.

### Input validation before launch

Before phase 2 opens Chrome or registers a long-running task, it validates:

- `phase1_index.json`;
- task configuration;
- shutdown policy;
- every referenced candidate JSON file;
- game names and candidate-array structure.

The report is written to:

```text
<RunDir>/phase2_input_validation.json
```

Manual validation command:

```powershell
node .\scripts\validate_phase2_inputs.js `
  --index ".\runs\example\phase1_index.json" `
  --config ".\runs\example\task_config.json"
```

### Verified phase-2 startup

The scheduled runner no longer reports success merely because PowerShell or Node obtained a PID. A supervisor starts phase 2 and waits until `phase2_progress.json` is newly written or updated and can be parsed. Only then is:

```text
startup_verified = true
status = phase2_running
```

written to `scheduled_phase2_runner_status.json`.

Immediate startup failures retain the child exit code and stderr tail instead of silently stopping.

### Standard handoff instead of ad hoc scripts

When the user asks Codex to run a second phase-2 batch after the current Facebook task, Codex should use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\queue_phase2_after_current.ps1 `
  -CurrentRunDir ".\runs\current_task" `
  -Index ".\runs\next_task\phase1_index.json" `
  -RunDir ".\runs\next_task" `
  -Config ".\runs\next_task\task_config.json"
```

The handoff script:

- waits for a verified current-task completion file;
- validates the target inputs;
- starts phase 2 through the normal V6.6.0 scheduler chain;
- verifies actual progress startup;
- records explicit failure details;
- retries launch failures according to `-MaxStartAttempts`, `-RetryIntervalSeconds`, and optional `-RetryUntil`.

Status is written to:

```text
<RunDir>/phase2_handoff_status.json
```

Codex must not recreate temporary JSON through `Set-Content -Encoding UTF8` or build one-off wait scripts when this built-in handoff applies.

## Semantic provider order

```text
configured custom APIs, in file order
→ verified standalone Codex CLI (`codex exec`)
→ deterministic local rules and controlled GeoNames
```

Useful checks:

```powershell
npm run semantic:verify-api
npm run semantic:verify-chain
npm run semantic:diagnose
npm run semantic:verify-codex
```

Private provider settings remain outside this package in:

```text
config/local/semantic_model.local.json
```

## Shutdown behavior

Default: do not shut down.

Codex converts the user’s current natural-language instruction into the run-specific `shutdown_policy.json`. Shutdown is permitted only after final workbook/report generation, finalized checkpoints, completion verification, Chrome closure, and deadline validation all succeed.

No new npm dependency is required.
