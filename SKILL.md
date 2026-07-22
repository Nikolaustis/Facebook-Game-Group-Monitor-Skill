---
name: facebook-group-monitor
version: 6.6.2
description: Two-stage Facebook game-group monitoring with multi-game group preservation, Node-verified shutdown finalization, isolated Codex CLI discovery, API-first semantic region adjudication, BOM-safe inputs, verified startup, durable recovery, retryable handoff, and prompt-driven shutdown.
---

# Facebook Group Monitor V6.6.2

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

## Mandatory multi-game output rule

Do not force one Facebook URL to belong to only one game. The authoritative uniqueness key is:

```text
group_url + game_name
```

When one group clearly matches several target games, preserve one final `detail` row for each matched game. Do not use `drop_all_tied` for cross-game equal scores.

Only duplicate records that share both the same normalized `group_url` and the same `game_name` may be collapsed. Keep the highest-scoring same-game record and record the discarded duplicates in `collision_report.json`.

Expected collision resolutions:

```text
keep_each_matched_game
deduplicate_same_game_keep_highest_score
```

## Mandatory shutdown verification rule

Do not parse the full `phase2_autosave_state.json` with Windows PowerShell 5.1 `ConvertFrom-Json` as the authoritative shutdown check. Large checkpoints can exceed PowerShell’s reliable JSON parsing range.

Use:

```text
scripts/verify_shutdown_state.js
```

The Node verifier must read the large checkpoint, progress, completion, policy, and final outputs, then write:

```text
<RunDir>/shutdown_preflight_verification.json
```

The runner coordinator and direct watcher may issue shutdown only when the small verification report has `all_valid=true` and the current deadline policy permits shutdown. Any JSON read failure must be recorded in `read_errors`; it must not be silently represented as a false finalization flag.

## Mandatory Codex CLI isolation

Never create, set, recommend, or depend on the global environment variable:

```text
CODEX_CLI_PATH
```

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

## Mandatory JSON handling

Use `scripts/json_io.js` for JavaScript JSON reads. PowerShell-generated JSON must use UTF-8 without BOM through package helpers. Do not use ad hoc `Set-Content -Encoding UTF8` for phase indexes, task configurations, manifests, policies, or status JSON.

## Verified startup contract

A PID is not proof of successful collection. Startup is successful only when the input preflight passed, the phase-2 child process is alive, and a fresh readable `phase2_progress.json` exists. Startup failures must retain the exit code and stderr tail.

## Chained task requests

Use `scripts/queue_phase2_after_current.ps1` when the user asks to run another second-round batch after the current Facebook task. Do not create temporary wait scripts when the built-in handoff can represent the request.

## XLSX output contract

The workbook field order in this package is authoritative. `manual_review` begins with the same columns as `detail`; review-only fields follow afterward. New audit fields must be appended and must not reorder existing columns.
