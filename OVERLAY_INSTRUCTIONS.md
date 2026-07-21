# V6.6.0 Overlay Instructions

1. Stop active phase-2 and handoff processes before replacing files.
2. Extract this archive into the existing Facebook Group Monitor Skill root and replace files with matching paths.
3. Do not delete or overwrite:

```text
runs/
config/
node_modules/
```

These directories are intentionally excluded from the package.

4. No new `npm install` is required when the existing installation already has the package dependencies.
5. Validate JavaScript entry files if desired:

```powershell
node --check .\scripts\phase2_collect_details.js
node --check .\scripts\phase2_supervisor.js
node --check .\scripts\validate_phase2_inputs.js
```

6. Before a real phase-2 run, preflight its files:

```powershell
node .\scripts\validate_phase2_inputs.js `
  --index ".\runs\example\phase1_index.json" `
  --config ".\runs\example\task_config.json"
```

7. For “run after the current Facebook task”, use `scripts/queue_phase2_after_current.ps1` rather than a temporary Codex-generated waiter.
8. The package preserves the output XLSX field order from the uploaded base archive.
