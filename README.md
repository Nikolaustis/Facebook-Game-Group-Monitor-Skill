# Facebook Group Monitor Skill V6.5.4

V6.5.4 is a cumulative overlay for the two-stage Facebook game-group monitor. It includes phase-1 candidate collection, phase-2 name prefiltering, sibling-game attribution, multilingual language and region rules, API-first semantic ambiguity adjudication, verified Codex CLI fallback, controlled GeoNames, aligned `detail` and `manual_review` sheets, per-candidate full checkpoints, scheduled recovery, task self-deletion, and prompt-driven shutdown.

## Semantic provider order

The runtime provider chain is fixed:

```text
configured custom APIs, in file order
→ verified standalone Codex CLI (`codex exec`)
→ deterministic local rules and controlled GeoNames
```

A high-confidence API decision is accepted. A valid API decision below the configured confidence threshold continues to the next API or Codex. Request failures, invalid JSON, invalid Schema output, or unavailable providers also continue through the fallback chain.

## API verification

Run an API-only check without consuming Codex:

```powershell
npm run semantic:verify-api
```

V6.5.4 treats both of these as successful verification:

```text
API returned valid Schema output at or above the confidence threshold
API returned valid Schema output below the threshold and correctly continued to fallback
```

The second case is not an API failure. It proves that the endpoint, authentication, request format, JSON parsing, and Schema validation all worked, while the confidence policy correctly refused to accept the result.

Actual failures still return a nonzero exit code, including:

- no configured API;
- no request issued;
- HTTP or network failure;
- invalid JSON;
- Schema validation failure;
- no valid semantic decision.

The report is written to:

```text
semantic_provider_diagnostic.json
```

Its `verification` object includes:

```json
{
  "ok": true,
  "status": "api_valid_low_confidence_fallback",
  "api_requests": 1,
  "api_errors": 0,
  "api_returned_valid_decision": true,
  "low_confidence_fallback_observed": true
}
```

## Other verification commands

Verify the complete API → Codex → rules chain:

```powershell
npm run semantic:verify-chain
```

Check Codex CLI discovery and login without a model request:

```powershell
npm run semantic:diagnose
```

Run one real Schema-constrained Codex request:

```powershell
npm run semantic:verify-codex
```

## API configuration

Private provider settings remain in:

```text
config/local/semantic_model.local.json
```

The overlay does not include or overwrite that file. The public example remains at:

```text
config/local/semantic_model.local.example.json
```

## Safe fallback

Models cannot directly write the normalized final region. Their output is Schema-validated, candidate places must be supported by source text, and final region mapping remains deterministic. Collection continues with local rules and controlled GeoNames when no model provider succeeds.

## Shutdown behavior

The default remains no shutdown. Codex translates the user's current instruction into the run-specific `shutdown_policy.json`. Shutdown is allowed only after final files, finalized checkpoints, completion verification, and Chrome closure all succeed. Completed scheduled tasks and temporary shutdown tasks delete themselves.

No new npm dependency is required.
