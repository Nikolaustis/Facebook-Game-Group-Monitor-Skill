# V6.5.4 Overlay Instructions

1. Stop any active phase-2 collection before replacing files.
2. Extract this archive into the existing Facebook Group Monitor Skill root.
3. Replace files with the same paths.
4. Do not delete or overwrite `config/local/semantic_model.local.json`; it contains private provider settings and is excluded from this package.
5. No new `npm install` is required.
6. Run:

```powershell
npm run semantic:verify-api
```

7. Exit code `0` now means the API either produced an accepted decision or produced valid low-confidence Schema output and correctly continued to fallback.
8. Inspect `semantic_provider_diagnostic.json` and its `verification` object for the exact result.
9. Optionally verify the complete fallback chain:

```powershell
npm run semantic:verify-chain
```
