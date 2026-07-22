# Facebook Group Monitor Skill V6.6.2

V6.6.2 is a cumulative Windows-oriented Facebook game-group monitoring package. It preserves the uploaded XLSX field order and adds two reliability corrections: legitimate multi-game groups are retained once for every matched target game, and shutdown finalization is verified by Node.js rather than Windows PowerShell 5.1 parsing the full autosave checkpoint.

## Main workflow

1. Phase 1 collects group candidates and source-query metadata.
2. Phase 2 validates all JSON inputs before launch and prefilters irrelevant group names before opening About or discussion pages.
3. Target titles, aliases, controlled variants, sibling games, and IP-root-only matches are evaluated separately.
4. Language and region use deterministic evidence first, then configured APIs, a verified standalone Codex CLI, local rules, and controlled GeoNames.
5. A complete checkpoint is saved after every candidate.
6. `detail` and `manual_review` retain the workbook field order supplied in the uploaded base package.
7. Phase-2 startup is considered successful only after a fresh readable progress checkpoint appears.
8. Queued batches use the built-in retryable handoff workflow.
9. Chrome closes after verified finalization. Scheduled tasks delete themselves. Shutdown remains prompt-driven and defaults to disabled.

## Multi-game group output

A Facebook group can legitimately cover several target games. V6.6.2 uses this final-output uniqueness key:

```text
group_url + game_name
```

Therefore a group such as:

```text
ANIME VANGUARDS / ANIME LAST STAND (BUY / SELL / TRADE)
```

is retained twice when both title matches are valid:

```text
same group_url + Anime Vanguards
same group_url + Anime Last Stand
```

Only duplicate rows for the same URL and the same target game are collapsed to the highest-scoring match. `collision_report.json` records:

```text
keep_each_matched_game
deduplicate_same_game_keep_highest_score
```

New audit statistics:

```text
multi_game_groups_preserved
multi_game_rows_preserved
same_game_duplicate_rows_dropped
```

## Large-checkpoint-safe shutdown verification

The full `phase2_autosave_state.json` can exceed 2 MB. Windows PowerShell 5.1 `ConvertFrom-Json` may fail on such files, even though Node.js wrote and verified them correctly.

V6.6.2 adds:

```text
scripts/verify_shutdown_state.js
```

The shutdown coordinator now asks Node.js to read and validate:

- final XLSX, summary, collision, audit, and debug rows;
- `phase2_autosave_state.json`;
- `phase2_progress.json`;
- `codex_task_complete.json`;
- `shutdown_policy.json`.

Node writes a small report:

```text
<RunDir>/shutdown_preflight_verification.json
```

PowerShell reads only this small report before issuing `shutdown.exe`. JSON parse failures are recorded instead of being silently converted to `checkpoint_finalized=false`.

Manual verification command:

```powershell
npm run phase2:verify-shutdown -- --run-dir ".\runs\your_run"
```

## Semantic provider order

```text
configured custom APIs
→ verified standalone Codex CLI
→ local rules and controlled GeoNames
```

The Skill ignores the global `CODEX_CLI_PATH` variable and removes it from semantic child-process environments. Prefer `codex_exec.command`, ordinary PATH/npm discovery, or the optional Skill-private `FB_MONITOR_CODEX_CLI_PATH` override.

## Installation

Extract this overlay into the existing Skill root and replace matching files. Do not replace or delete:

```text
runs/
config/
node_modules/
```

No new npm dependency is required.
