---
name: facebook-group-monitor
version: 6.6.4
description: Two-stage Facebook game-group monitoring with safe short-alias boundaries, sibling alias exclusion, same-business-region preservation, isolated supervisor logs, verified Windows startup, multi-game output, Node-verified shutdown, API-first semantic adjudication, BOM-safe inputs, durable recovery, and prompt-driven shutdown.
---

# Facebook Group Monitor V6.6.4

## Operating sequence

1. Collect phase-1 candidates with source-query metadata.
2. Validate phase-2 index, configuration, shutdown policy, and all candidate files before launch.
3. Prefilter first-round group names before opening About or discussion pages.
4. Validate target titles, aliases, controlled variants, sibling titles, sibling aliases, and IP-root-only matches.
5. Resolve language and region with deterministic evidence first.
6. For unresolved risk candidates use:

```text
custom APIs in configured order
→ verified standalone Codex CLI
→ local rules and controlled GeoNames
```

7. Save a complete checkpoint after every candidate.
8. Generate aligned `detail` and `manual_review` sheets using the authoritative field order in this package.
9. Close Chrome after successful finalization and delete completed scheduled tasks.
10. Default to no shutdown. Build the run-specific shutdown policy only from the user's current instruction.

## Mandatory short-alias rule

Never use unrestricted substring matching for a short Latin alias. A short alias must be a standalone token with Latin-letter/number boundaries.

For aliases containing a trailing number, separators between letters and the number are equivalent:

```text
GAG2 = GAG 2 = GAG-2
```

A shorter alias ending in letters must not match a numbered continuation:

```text
GAG does not match GAG2 or GAG 2
```

It must also not match longer words such as `gags`, `gagged`, or `9gag`.

Sibling exclusion must include each sibling game's canonical title, aliases, and configured title variants. A more specific sibling form must suppress a shorter contained-title match.

## Mandatory same-business-region rule

When explicit country keywords and/or flags identify several countries that all normalize to one business-region bucket, preserve that bucket and mark the source with `_same_business_region`.

Do not send a resolved same-business-region result through cross-region About adjudication. Example:

```text
LA + TH → SEA
```

## Mandatory multi-game output rule

Final-output uniqueness is:

```text
group_url + game_name
```

When one group independently and clearly matches multiple target games, preserve one final row for each matched game. Only same-URL, same-game duplicates may be collapsed, keeping the highest score.

## Mandatory resume revalidation

On resume from a non-finalized full checkpoint, revalidate staged rows whose prior match type was a strong group-name title match. Remove rows that no longer satisfy the current title and sibling rules, and record the removal count and examples in runtime statistics.

## Mandatory supervisor-log isolation

`phase2_supervisor.js` owns the phase-2 child stdout and stderr files. `scheduled_phase2_runner.ps1` must write supervisor wrapper output to separate files. Do not treat a PID alone as startup success; require a live phase-2 child and fresh readable `phase2_progress.json`.

## Mandatory shutdown verification

Use `scripts/verify_shutdown_state.js` to read the full checkpoint, progress, completion, policy, and final outputs. PowerShell may issue shutdown only from the small generated verification report with `all_valid=true` and a currently permitted shutdown policy.

## Mandatory Codex CLI isolation

Never create, set, recommend, or depend on the global `CODEX_CLI_PATH` environment variable. Prefer private configuration, normal PATH/npm discovery, or the Skill-specific `FB_MONITOR_CODEX_CLI_PATH` override.

## Mandatory JSON handling

Use `scripts/json_io.js` for JavaScript JSON reads. PowerShell-generated JSON must use UTF-8 without BOM.

## XLSX output contract

The workbook field order in this package is authoritative. `manual_review` begins with the same columns as `detail`; review-only fields follow afterward. New audit fields may be appended but must not reorder existing columns.
