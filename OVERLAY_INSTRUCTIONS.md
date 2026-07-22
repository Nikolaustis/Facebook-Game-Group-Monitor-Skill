# V6.6.2 Overlay Instructions

1. Stop any active Facebook Group Monitor task before replacing files.
2. Extract this archive into the existing Skill root and replace files with matching paths.
3. Do not replace or delete `runs/`, `config/`, or `node_modules/`.
4. No new npm dependency is required.
5. Do not create the global environment variable `CODEX_CLI_PATH`.
6. After replacement, optional checks:

```powershell
node --check .\scripts\phase2_collect_details.js
node --check .\scripts\finalize_partial_xlsx.js
node --check .\scripts\verify_shutdown_state.js
```

To inspect a completed run’s shutdown eligibility without shutting down:

```powershell
npm run phase2:verify-shutdown -- --run-dir ".\runs\your_run"
```

The overlay does not include private API configuration, run data, or npm dependencies.
