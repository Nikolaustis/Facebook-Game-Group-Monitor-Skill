---
name: facebook-group-monitor
version: 6.6.0
description: Two-stage Facebook game-group monitoring with BOM-safe inputs, verified phase-2 startup, retryable task handoff, API-first semantic region adjudication, durable recovery, and prompt-driven shutdown.
---

# Facebook Group Monitor V6.6.0

## Operating sequence

1. Collect phase-1 candidates with source-query metadata.
2. Prefilter first-round group names before opening About or discussion pages.
3. Validate target titles, aliases, controlled variants, sibling titles, and IP-root-only matches.
4. Collect size, activity, weekly growth, About data, and discussion-language evidence only when required.
5. Resolve language and region with deterministic evidence first.
6. For unresolved risk candidates, use:

```text
custom APIs in configured order
→ verified standalone Codex CLI
→ local rules and controlled GeoNames
```

7. Save a complete checkpoint after every candidate.
8. Generate aligned `detail` and `manual_review` sheets using the field order already present in the uploaded base package.
9. Close Chrome after successful finalization and delete completed scheduled tasks.
10. Default to no shutdown. Generate the run-specific shutdown policy only from the user’s current instruction.

## Mandatory JSON handling

Use `scripts/json_io.js` for JavaScript JSON reads. It accepts UTF-8 BOM and UTF-16 input and produces descriptive errors.

PowerShell-generated JSON must use UTF-8 without BOM through the package’s `Write-Utf8NoBom` / `Write-JsonAtomic` helpers. Do not use ad hoc:

```powershell
Set-Content -Encoding UTF8
```

for phase indexes, task configurations, manifests, policies, or status JSON.

## Mandatory phase-2 preflight

Before starting phase 2, validate the index, configuration, policy, and all candidate files with:

```powershell
node .\scripts\validate_phase2_inputs.js --index "<index>" --config "<config>"
```

Do not start Chrome or create a scheduled task when preflight fails.

## Verified startup contract

A PID is not proof of successful collection. V6.6.0 considers startup successful only when:

- the input preflight passed;
- the phase-2 child process is alive;
- `phase2_progress.json` was newly written or updated after launch;
- the progress JSON is readable;
- `scheduled_phase2_runner_status.json` states `phase2_running` and `startup_verified=true`.

Startup failures must retain the exit code and stderr tail.

## Chained task requests

When the user says “after the current Facebook task finishes, run another phase 2”, use:

```text
scripts/queue_phase2_after_current.ps1
```

Do not create a temporary wait script unless the built-in handoff cannot represent the request.

The handoff must:

1. wait for `codex_task_complete.json` with finalization verification;
2. validate target JSON inputs;
3. call the normal `start_background_task.ps1 -Task phase2` path;
4. wait for verified progress startup;
5. retry startup failures when allowed;
6. write `phase2_handoff_status.json` with a clear terminal state.

A shutdown deadline controls whether the completed target task shuts down the computer. It is not a reason to silently abandon a valid collection unless the user explicitly says the collection itself must not start after that deadline.

## XLSX output contract

The workbook field order in this package is authoritative. `manual_review` begins with the same columns as `detail`; review-only fields follow afterward. New audit fields must be appended and must not reorder existing columns.

## Provider verification

```powershell
npm run semantic:verify-api
npm run semantic:verify-chain
npm run semantic:diagnose
npm run semantic:verify-codex
```

A valid low-confidence API response that correctly falls back is a successful API transport/Schema verification, not an API failure.
