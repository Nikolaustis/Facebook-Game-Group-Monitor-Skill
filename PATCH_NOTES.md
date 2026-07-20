# V6.5.4 Patch Notes

- Corrected `npm run semantic:verify-api` so a valid low-confidence API response is treated as a successful API verification.
- The API-only diagnostic now distinguishes three outcomes:
  - valid API decision accepted;
  - valid API decision parsed but below the confidence threshold and correctly forwarded to fallback;
  - actual request, HTTP, JSON, or Schema failure.
- Added a structured `verification` block to `semantic_provider_diagnostic.json`.
- API-only verification now exits with code `0` for both accepted and valid-low-confidence outcomes.
- Actual API configuration, request, parse, or Schema failures still return a nonzero exit code.
- Retained API-first ordering, DeepSeek JSON compatibility, Codex CLI fallback, deterministic rules, controlled GeoNames, durable checkpoints, scheduled recovery, and prompt-driven shutdown.
