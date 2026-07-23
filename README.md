# Facebook Group Monitor Skill V6.6.4

V6.6.4 is a cumulative Windows-oriented Facebook game-group monitoring package. This release fixes two deterministic classification defects found in the Grow a Garden / Grow a Garden 2 run: loss of a valid same-business-region result, and unsafe short-alias substring matching.

## Main workflow

1. Phase 1 collects group candidates and source-query metadata.
2. Phase 2 validates its index, task configuration, shutdown policy, and candidate files before launch.
3. Irrelevant first-round group names are skipped before opening About or discussion pages.
4. Target titles, aliases, controlled variants, sibling games, and IP-root-only matches are evaluated separately.
5. Language and region use deterministic evidence first, then configured APIs, a verified standalone Codex CLI, local rules, and controlled GeoNames.
6. A complete checkpoint is saved after every candidate.
7. `detail` and `manual_review` retain the authoritative XLSX field order in this package.
8. Legitimate multi-game groups are retained once for each matched target game.
9. Chrome closes after verified finalization. Scheduled tasks remove themselves. Shutdown defaults to disabled and follows only the current user instruction.

## Same-business-region preservation

When several explicit countries belong to the same business region, their combined result is authoritative. For example:

```text
Laos + Thailand
→ LA + TH
→ SEA
→ source: country_keyword_and_flag_same_business_region
```

This result is not treated as an unresolved cross-region conflict and does not require About-location adjudication.

## Short-alias matching

Short Latin aliases use token boundaries instead of raw compact substring matching.

```text
GAG       → valid Grow a Garden alias
GAGS      → not GAG
GAGGED    → not GAG
9GAG      → not GAG
GAG2      → not GAG; valid GAG2
GAG 2     → not GAG; valid GAG2
```

Sibling exclusion includes canonical titles, aliases, and configured title variants. This prevents `Grow a Garden 2`, `GAG2`, or `GAG 2` from being attributed to `Grow a Garden` merely because the shorter string appears inside the longer one.

The multi-game rule remains unchanged. A name that independently and explicitly contains two complete target titles may still be retained under both games.

## Resume protection

When resuming a non-finalized checkpoint, rows previously accepted through a strong group-name title match are rechecked against the current title rules. Invalid legacy rows are removed from staged output and counted in:

```text
phase2_resume_title_rows_revalidated
phase2_resume_title_rows_removed
phase2_resume_title_rows_removed_examples
```

## Existing runtime protections

- Supervisor and phase-2 child logs use separate files.
- Startup success requires a live child and fresh readable progress.
- Shutdown verification uses Node.js for the full checkpoint.
- The global `CODEX_CLI_PATH` variable is ignored.
- JavaScript JSON reads are BOM-safe.
- PowerShell-generated JSON uses UTF-8 without BOM.

## Installation

Extract the overlay into the existing Skill root and replace matching files. Preserve:

```text
runs/
config/
node_modules/
```

No new npm dependency is required.
