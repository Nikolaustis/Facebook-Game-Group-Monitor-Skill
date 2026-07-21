# V6.6.1 Overlay Instructions

1. Stop any active Facebook Group Monitor task before replacing files.
2. Extract this archive into the existing Skill root and replace files with matching paths.
3. Do not replace or delete `runs/`, `config/`, or `node_modules/`.
4. Do not create the global environment variable `CODEX_CLI_PATH`.
5. Keep the standalone Codex CLI on PATH or specify `semantic_region_resolver.codex_exec.command` in the private local configuration.
6. Optional Skill-private override: `FB_MONITOR_CODEX_CLI_PATH`.
7. Restart the Codex/ChatGPT desktop application after removing any persistent legacy variable.
8. Validate with:

```powershell
npm run semantic:diagnose
npm run semantic:verify-codex
```

The overlay does not include private API configuration, run data, or npm dependencies.
