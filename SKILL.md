---
name: facebook-group-monitor
version: 6.5.4
description: Two-stage Facebook game-group monitoring with API-first semantic region adjudication, Codex CLI fallback, deterministic region rules, GeoNames verification, durable recovery, and prompt-driven shutdown.
---

# Facebook Group Monitor V6.5.4

## Operating sequence

1. Collect phase-1 candidates and retain source-query metadata.
2. Prefilter the phase-1 group name before opening About or discussion pages.
3. Validate target-game titles, aliases, controlled variants, sibling titles, and IP-root-only matches.
4. Collect group size, activity, weekly growth, About data, and discussion-language evidence only when required.
5. Resolve language and region with deterministic evidence first.
6. For unresolved risk or ambiguity candidates, use:

```text
custom APIs in configured order
→ verified standalone Codex CLI
→ local rules and controlled GeoNames
```

7. Accept only Schema-valid, source-supported model output. A low-confidence API result must continue to fallback.
8. Save a complete checkpoint after every candidate.
9. Generate aligned `detail` and `manual_review` sheets.
10. Close Chrome after successful finalization and delete completed scheduled tasks.
11. Default to no shutdown. Build the run-specific shutdown policy from the user's current instruction.

## Provider verification

Use:

```powershell
npm run semantic:verify-api
```

The command succeeds when the API returns either:

- a valid accepted decision; or
- a valid low-confidence decision that correctly continues to fallback.

It fails only for actual configuration, request, JSON, or Schema problems.

Use `npm run semantic:verify-chain` to verify the complete provider chain.
