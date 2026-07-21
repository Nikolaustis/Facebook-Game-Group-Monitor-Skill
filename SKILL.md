---
name: facebook-group-monitor
version: 6.6.1
description: Two-stage Facebook game-group monitoring with isolated Codex CLI discovery, API-first semantic region adjudication, BOM-safe inputs, verified phase-2 startup, durable recovery, retryable handoff, and prompt-driven shutdown.
---

# Facebook Group Monitor V6.6.1

## Operating sequence

1. Collect phase-1 candidates with source-query metadata.
2. Validate phase-2 index, configuration, shutdown policy, and all candidate files before launch.
3. Prefilter first-round group names before opening About or discussion pages.
4. Validate target titles, aliases, controlled variants, sibling titles, and IP-root-only matches.
5. Resolve language and region with deterministic evidence first.
6. For unresolved risk candidates, use:

```text
custom APIs in configured order
→ verified standalone Codex CLI
→ local rules and controlled GeoNames
```

7. Save a complete checkpoint after every candidate.
8. Generate aligned `detail` and `manual_review` sheets using the authoritative uploaded field order.
9. Close Chrome after successful finalization and delete completed scheduled tasks.
10. Default to no shutdown. Generate the run-specific shutdown policy only from the user’s current instruction.

## Mandatory Codex CLI isolation

Never create, set, recommend, or depend on the global environment variable:

```text
CODEX_CLI_PATH
```

V6.6.1 ignores that variable and removes it from semantic-resolver child processes. It may conflict with Codex/ChatGPT desktop startup when it points to a `.cmd` shim.

Use this discovery order:

```text
codex_exec.command in the private local configuration
→ FB_MONITOR_CODEX_CLI_PATH, only when an override is necessary
→ PATH / where.exe / Get-Command
→ npm and standalone CLI installation paths
```

Prefer:

```json
"codex_exec": {
  "command": "codex"
}
```

A direct path may be stored in `config/local/semantic_model.local.json`. Do not ask the user to create `CODEX_CLI_PATH` at User or Machine scope.

When the legacy variable is detected, explain that it is ignored and advise the explicit cleanup command:

```powershell
npm run semantic:clear-legacy-codex-env
```

Do not run cleanup automatically without the user requesting it.

## Mandatory JSON handling

Use `scripts/json_io.js` for JavaScript JSON reads. PowerShell-generated JSON must use UTF-8 without BOM through package helpers. Do not use ad hoc `Set-Content -Encoding UTF8` for phase indexes, task configurations, manifests, policies, or status JSON.

## Verified startup contract

A PID is not proof of successful collection. Startup is successful only when the input preflight passed, the phase-2 child process is alive, and a fresh readable `phase2_progress.json` exists. Startup failures must retain the exit code and stderr tail.

## Chained task requests

Use `scripts/queue_phase2_after_current.ps1` when the user asks to run another second-round batch after the current Facebook task. Do not create temporary wait scripts when the built-in handoff can represent the request.

## XLSX output contract

The workbook field order in this package is authoritative. `manual_review` begins with the same columns as `detail`; review-only fields follow afterward. New audit fields must be appended and must not reorder existing columns.

## Provider verification

```powershell
npm run semantic:verify-api
npm run semantic:verify-chain
npm run semantic:diagnose
npm run semantic:verify-codex
```

A valid low-confidence API response that correctly falls back is a successful transport/Schema verification, not an API failure.
