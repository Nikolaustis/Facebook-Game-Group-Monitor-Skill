# V6.6.2 Patch Notes

- Changed final-output uniqueness from `group_url` to `group_url + game_name`.
- Preserved legitimate multi-game groups once for every matched target game.
- Removed `drop_all_tied` behavior for cross-game equal-score matches.
- Kept highest-score deduplication only for duplicate rows belonging to the same URL and same game.
- Added `multi_game_groups_preserved`, `multi_game_rows_preserved`, and `same_game_duplicate_rows_dropped` audit counters.
- Updated live finalization and checkpoint recovery finalization to use the same multi-game policy.
- Added `scripts/verify_shutdown_state.js` for large-checkpoint-safe finalization checks.
- Changed the runner shutdown coordinator and direct shutdown watcher to consume the Node-generated small verification report.
- Added detailed JSON read errors, verifier stdout/stderr, file sizes, and per-check status to shutdown diagnostics.
- Added `npm run phase2:verify-shutdown -- --run-dir <RunDir>`.
- Preserved the uploaded XLSX field order and all existing semantic, GeoNames, checkpoint, handoff, task self-deletion, Codex CLI isolation, and prompt-driven shutdown behavior.
