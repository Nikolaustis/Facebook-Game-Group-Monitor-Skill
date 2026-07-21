# V6.6.1 Patch Notes

- Removed all reads of the global `CODEX_CLI_PATH` environment variable.
- Added the Skill-private optional override `FB_MONITOR_CODEX_CLI_PATH`.
- Kept `codex_exec.command` and ordinary PATH/npm discovery as the preferred mechanisms.
- Stripped `CODEX_CLI_PATH` from all child-process environments created by the semantic resolver.
- Replaced error messages that previously recommended configuring `CODEX_CLI_PATH`.
- Added non-secret diagnostics showing whether the legacy variable was detected and ignored.
- Added the explicit `semantic:clear-legacy-codex-env` cleanup command; it is never run automatically.
- Updated the Codex CLI installer guidance to prohibit the global variable.
- Added semantic diagnostic files to `.gitignore`.
- Preserved BOM-safe JSON input handling, verified phase-2 startup, retryable handoff, API-first semantic adjudication, workbook field order, durable checkpoints, task self-deletion, and prompt-driven shutdown.
