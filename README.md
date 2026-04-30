# FB Game Group Monitor Skill V3.5

A Codex Skill for two-stage Facebook game group monitoring.

It searches Facebook groups by raw game titles, collects candidate groups, applies strict game-title relevance rules, and exports CSV/Excel plus audit files. It is designed for game communities where same-IP titles are easy to confuse, such as `Ragnarok M`, `Ragnarok Origin`, `LINE Rangers`, and similar sibling games.

## Key Features

- Two-stage workflow: login first, then Phase 1 search, then Phase 2 detail collection.
- Raw-title Phase 1 search only: no automatic keyword expansion.
- Strict sibling-game exclusion: a sibling title in `group_name` blocks false positives.
- Manual review queue: weak matches and ambiguous IP-root matches do not enter final output.
- Global monitoring by default: language and region are displayed, not used as hard filters unless configured.
- Region detection: region is primarily inferred from explicit semantics in `group_name`.
- Language detection V3.5: language is determined primarily from the first five visible discussion posts, with group name as auxiliary evidence.
- Safe about-text handling: “About this group” is used only as low-priority evidence when it contains user-written non-UI text.
- Excel export: stable column order, text `snapshot_date`, text `group_id`, formula columns, and percent formatting.

## Language And Region Rules

Language priority:

1. First five visible player posts in the group discussion area.
2. Group name as auxiliary evidence.
3. User-written “About this group” text only as lowest-priority fallback.

Do not use Facebook UI text, navigation text, button text, account-language text, or empty about-section structural labels as language evidence.

Region priority:

1. Explicit region/country semantics in `group_name`, such as `VN`, `Vietnam`, `Thailand`, `Indonesia`, `Mexico`, `México`, `PH`.
2. High-certainty language-to-region fallback only for languages such as Thai, Vietnamese, Indonesian, Malay, and Filipino.
3. Leave `region` empty when the region cannot be determined confidently.

English, Spanish, Chinese, Arabic, French, Portuguese, and similar languages should be displayed as language signals, but should not by themselves force a country/region.

## Outputs

Phase 2 generates:

- `fb_monitoring_filtered.csv`
- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `manual_review_queue.csv`
- `collision_report.json`
- `audit_stats.json`

Final detail columns:

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits
```

Excel-specific formatting:

- `snapshot_date` is written as text.
- `group_id` is written as text.
- `活跃指数=当日新帖/社群规模` uses `=IFERROR(Ix/Hx,"")`.
- `规模增速=上周新增/(社群规模-上周新增）` uses `=IFERROR(Jx/(Hx-Jx),"")`.
- Both formula columns are formatted as percentages with two decimal places.

## Repository Structure

- `SKILL.md`: Codex Skill instructions.
- `scripts/`: login, Phase 1, and Phase 2 scripts.
- `references/`: judgement rules, CSV schema, and quality checklist.
- `assets/`: task configuration template.
- `agents/`: optional agent metadata/config.
- `package.json`: Node.js dependencies and commands.

## Requirements

- Node.js
- Google Chrome
- A Facebook account that can be logged in manually

Install dependencies:

```powershell
npm install
```

Open Chrome for manual Facebook login:

```powershell
npm run login
```

Run Phase 1:

```powershell
npm run phase1 -- --games "LINE Idle Rangers" --out-dir ".\runs\demo" --cdp "http://127.0.0.1:9222"
```

Run Phase 2:

```powershell
npm run phase2 -- --index ".\runs\demo\phase1_index.json" --config ".\runs\demo\task_config.json" --out-csv ".\runs\demo\fb_monitoring_filtered.csv" --out-xlsx ".\runs\demo\fb_monitoring_filtered.xlsx"
```

## GitHub Upload List

Upload:

- `SKILL.md`
- `README.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`
- `package.json`
- `package-lock.json`
- `.gitignore`

Do not upload:

- `node_modules/`
- `runs/`
- Facebook output CSV/XLSX/JSON files
- browser cache, cookies, sessions, credentials, screenshots, or local temp files

## Privacy And Safety

This repository should not include Facebook credentials, cookies, tokens, or collected personal data. All monitoring should be performed through a manually logged-in browser session controlled by the user.
