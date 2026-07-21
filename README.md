# Facebook Group Monitor Skill V6.6.1

V6.6.1 is a cumulative Windows-oriented Facebook game-group monitoring package. It preserves the uploaded workbook field order and all V6.6 reliability features while isolating Codex CLI discovery from the desktop application environment.

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

## V6.6.1 Codex CLI environment isolation

The Skill no longer reads or relies on the global environment variable:

```text
CODEX_CLI_PATH
```

That name may also be interpreted by the Codex/ChatGPT desktop application. A user-level value pointing to an npm `.cmd` shim can interfere with desktop startup. V6.6.1 therefore:

- ignores `CODEX_CLI_PATH` even when it exists;
- removes it from every child-process environment created by the semantic resolver;
- never recommends creating it;
- records only a boolean warning in diagnostics, never its value;
- uses the following safe discovery order:

```text
semantic_region_resolver.codex_exec.command when it is an explicit path
→ FB_MONITOR_CODEX_CLI_PATH (Skill-private optional override)
→ PATH / where.exe / Get-Command
→ npm global installation paths
→ other standalone CLI paths
```

The preferred configuration is simply:

```json
{
  "semantic_region_resolver": {
    "codex_exec": {
      "command": "codex"
    }
  }
}
```

When a direct path is necessary, place it in the private local configuration instead of a global environment variable:

```json
{
  "semantic_region_resolver": {
    "codex_exec": {
      "command": "C:\\Users\\Og\\AppData\\Roaming\\npm\\codex.cmd"
    }
  }
}
```

An optional Skill-specific override is also supported:

```powershell
$env:FB_MONITOR_CODEX_CLI_PATH = "$env:APPDATA\npm\codex.cmd"
```

No override is normally required because npm and PATH discovery are built in.

### Remove the legacy variable

Explicit cleanup command:

```powershell
npm run semantic:clear-legacy-codex-env
```

This clears the current process and User-level `CODEX_CLI_PATH`. Machine-level cleanup is available only when explicitly running the script with `-IncludeMachine` in an elevated PowerShell.

After changing persistent environment variables, restart the Codex/ChatGPT desktop application.

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

The Codex diagnostic now reports:

```text
legacy_global_codex_cli_path_detected
legacy_global_codex_cli_path_ignored
private_skill_override_detected
child_processes_strip_legacy_global_override
```

It never writes the environment-variable value.

## JSON, startup, and handoff reliability

Core JSON readers accept UTF-8 with or without BOM and UTF-16 input. Phase 2 validates the index, config, shutdown policy, and every candidate file before launch. A PID alone is not considered a successful start: `phase2_progress.json` must be newly written or updated and readable.

For “run this batch after the current Facebook task”, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\queue_phase2_after_current.ps1 `
  -CurrentRunDir ".
uns\current_task" `
  -Index ".
uns
ext_task\phase1_index.json" `
  -RunDir ".
uns
ext_task" `
  -Config ".
uns
ext_task	ask_config.json"
```

## Shutdown behavior

Default: do not shut down.

Codex converts the user’s current natural-language instruction into the run-specific `shutdown_policy.json`. Shutdown is permitted only after final workbook/report generation, finalized checkpoints, completion verification, Chrome closure, and deadline validation all succeed.

No new npm dependency is required.
