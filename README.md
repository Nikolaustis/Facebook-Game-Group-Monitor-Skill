# FB Group Monitor Skill V3.2

A reusable Codex skill for two-stage Facebook game group monitoring.

This skill standardizes the workflow of:
- manual Facebook login
- phase 1 candidate collection by raw game title
- phase 2 `/about` collection and strict filtering
- final export to CSV, Excel, JSON summary, collision report, audit stats, and manual review queue

It is designed for multi-game monitoring tasks where title ambiguity, sibling-game collisions, and noisy Facebook search results need to be handled conservatively.

## What V3.2 Improves

Compared with earlier versions, V3.2 focuses on accuracy and stability:

- Unicode-safe matching and file naming
  - avoids collisions for Thai and other non-ASCII game titles
- sibling-game hard exclusion
  - a sibling title hit in `group_name` blocks false positives
- longer exact title priority
  - more specific full titles win over shorter overlapping titles
- manual review queue
  - weak positives such as `exact_phrase_in_full_text` are separated from final output
- global language and region handling
  - language and region are displayed, not hard-limited by default
- region keyword detection
  - region can be inferred from explicit country keywords in group name, snippet, or about text
- more stable `/about` extraction
  - reduces `about_failed` through multi-URL fallback and better text extraction

## Core Workflow

### 1. Login stage
- run `scripts/open_chrome_9222.ps1`
- manually log in to Facebook
- do not start search, collection, analysis, or reporting until the user replies `已登录`

### 2. Phase 1: candidate collection
- search with the original game title only
- do not expand aliases automatically
- stop deep scrolling only when stop conditions are reached
- ask the user before moving to phase 2

### 3. Phase 2: detail collection and filtering
- only groups with `group_size >= 100` enter `/about`
- apply strict relevance checks
- apply sibling-game ownership rules
- apply conflict resolution by `group_url`
- export strict-pass samples and separate manual-review samples

## Key Filtering Rules

- `exact_phrase_in_group_name` is treated as a strong positive
- sibling-game title hit in `group_name` is a hard negative
- `exact_phrase_in_full_text` does not enter final CSV by default
- groups that only hit IP roots or weak full-text matches go to `manual_review_queue.csv`
- the same `group_url` can belong to only one game
- tied highest-score ownership conflicts are dropped into `collision_report.json`
- language and region are kept as output fields
- language and region are not hard-filtered unless explicitly configured

## Outputs

- `fb_monitoring_filtered.csv`
- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `manual_review_queue.csv`
- `collision_report.json`
- `audit_stats.json`

## Repository Structure

- `SKILL.md`
  - skill entry instructions and workflow rules
- `agents/openai.yaml`
  - Codex skill metadata
- `scripts/`
  - login, phase 1, and phase 2 scripts
- `references/`
  - judgement rules, CSV schema, quality checklist
- `assets/`
  - config templates
- `package.json`
  - runtime dependencies

## Requirements

- Node.js
- Google Chrome
- a Facebook account that can log in manually

Install dependencies:

```powershell
npm install
```

## Quick Start

Open Facebook login page:

```powershell
npm run login
```

Run phase 1 with raw game titles:

```powershell
npm run phase1 -- --games "LINE Rangers,LINE Idle Rangers" --out-dir ".\\runs\\demo" --cdp "http://127.0.0.1:9222"
```

Run phase 2 with an existing phase 1 index:

```powershell
npm run phase2 -- --index ".\\runs\\demo\\phase1_index.json" --config ".\\assets\\task_config.template.json" --out-csv ".\\runs\\demo\\fb_monitoring_filtered.csv" --out-xlsx ".\\runs\\demo\\fb_monitoring_filtered.xlsx"
```

Run the combined PowerShell workflow:

```powershell
npm run monitor -- -Games "LINE Rangers,LINE Idle Rangers" -Config ".\\assets\\task_config.template.json"
```

## Recommended Usage

1. Open Chrome with remote debugging through `scripts/open_chrome_9222.ps1`
2. Log in to Facebook manually
3. Run phase 1 with raw game titles only
4. Confirm whether to stop after deep-scroll stop conditions are reached
5. Run phase 2 and export final outputs

## Recommended Files To Share

Include:
- `SKILL.md`
- `README.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`
- `package.json`
- `package-lock.json`
- `.gitignore`

Exclude:
- `node_modules/`
- `runs/`
- local `.zip` packages
- temporary screenshots or local cache files

## Notes

- This repository does not include Facebook credentials or session data.
- Public sharing should exclude local output folders and runtime caches.
- If you publish this repository, add a license file according to your preferred open-source terms.
