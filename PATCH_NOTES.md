# V6.6.4 Patch Notes

- Fixed same-business-region evidence loss when country keywords and flag emoji independently collapse several countries into one business region.
- A group name containing Laos and Thailand evidence now resolves directly to `SEA` with source `country_keyword_and_flag_same_business_region` instead of being cleared by the multi-region adjudication path.
- Replaced unrestricted compact substring matching for short Latin aliases with token-boundary matching.
- Short aliases such as `GAG` no longer match `gags`, `gagged`, `9gag`, `GAG2`, or `GAG 2`.
- Alphanumeric aliases such as `GAG2` accept both compact and separated forms, including `GAG2`, `GAG 2`, and punctuation-separated equivalents.
- Sibling-title exclusion now includes sibling aliases and configured title variants, not only canonical sibling titles.
- `Grow a Garden 2`, `GAG2`, and `GAG 2` therefore exclude a false `Grow a Garden` match while remaining valid for `Grow a Garden 2`.
- A group that explicitly contains two genuinely distinct titles can still be retained once under each game under the existing `group_url + game_name` rule.
- Non-finalized checkpoints are conservatively revalidated on resume. Previously staged rows whose strong group-name match is invalid under the current title rules are removed and counted in resume audit statistics.
- Preserved the authoritative XLSX field order, supervisor-log isolation, multi-game output, Node-verified shutdown, API-first semantic chain, BOM-safe JSON, and prompt-driven shutdown behavior.
