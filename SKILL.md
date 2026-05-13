---
name: fb-group-monitor-v3.6.3
description: 用于 Facebook 游戏群组两阶段监测的严格技能。先登录，再采集；第一轮按每个游戏独立生成受控标题变体；第二轮按严格标题匹配、兄弟游戏排斥、变体专用活跃阈值、语言/地区识别和冲突归属输出 Excel 工作簿与 JSON 审计文件。V3.6.3 不再读写或保存 CSV；第二轮改为轻量进度 JSON 每候选保存、有效行 xlsx 立即保存。
---

# Facebook Group Monitor V3.6.3

## 必须先读

- `SKILL.md`
- `references/judgement_rules.md`
- `references/quality_checklist.md`
- `references/xlsx_schema.md`
- `assets/task_config.template.json`

## 登录阶段

1. 先运行 `scripts/open_chrome_9222.ps1`。
2. 提示用户手动登录 Facebook。
3. 用户回复“已登录”之前，不得搜索、采集、分析或生成报告。

## 第一轮

第一轮支持一次任务同时检索多个游戏。每个游戏独立生成搜索计划：

- 自动搜索原始标题。
- 自动搜索低风险标题变体：标点归一、冒号/破折号归一、少空格/去空格紧凑标题。
- 不自动扩展过宽关键词，例如 `Anime`、`Ragnarok`、`Tower Defense`、`All Star`。
- `connector_x` 默认关闭，只能通过 `title_variant_overrides` 配置开启。
- `seed_group_urls` 只强制进入第二轮检查，不代表自动进入最终 detail。

第一轮候选需保留：

```text
source_query, query_variant_type, source_game_name, source_is_seed_url, source_queries, query_variant_types
```

达到深翻停止条件后，必须先问用户：

```text
可以停止，继续 / 继续深翻
```

## 第二轮

只有用户确认继续后，才运行 `scripts/phase2_collect_details.js`。

第二轮规则：

- 成员数 `< 100` 的候选不进入详情采集。
- `/about` 抓取失败的记录不进入最终输出。
- `group_name` 按词序完整命中目标标题，作为 `exact_phrase_in_group_name` 强正样本。
- `group_name` 命中去空格/少空格标题，作为 `compact_title_in_group_name` 正样本。
- `group_name` 命中配置 allowlist 中的 X 连接变体，作为 `connector_x_title_in_group_name` 弱正样本，必须通过更高活跃门槛。
- 多游戏批量检索时，自动把同批次其他游戏作为兄弟标题排斥，避免互相串群。
- 仅 IP 大词根命中、仅 full_text 命中、`exact_phrase_in_full_text` 等记录进入人工复核 sheet。
- 同一个 `group_url` 只能归属一个游戏；最高分并列冲突写入 `collision_report.json`。

活跃阈值：

- 普通命中满足 `today_posts >= threshold` 或 `week_new_fans >= threshold`。
- `connector_x_title_in_group_name` 默认需满足 `group_size >= 1000`，且 `today_posts >= max(threshold, 20)` 或 `week_new_fans >= max(threshold, 50)`。

## 配置示例

```json
{
  "title_variant_overrides": {
    "All Star Tower Defense": {
      "search_variants": [
        {
          "query": "All Star X Tower Defense",
          "type": "connector_x",
          "min_group_size": 1000,
          "min_today_posts": 20,
          "min_week_new_fans": 50
        }
      ],
      "seed_group_urls": [
        "https://www.facebook.com/groups/1992312010946763",
        "https://www.facebook.com/groups/allstarshinobi"
      ]
    }
  }
}
```

## 语言判断

语言判断优先级：

1. 讨论区前五条可见玩家发言。
2. 群组名称。
3. 用户手写的“关于这个小组”非 UI 文本，仅作为最低优先级兜底。

禁止把以下内容当作语言证据：

- Facebook 账号界面语言。
- 按钮、导航、固定提示文案。
- 空 about 区块的结构标签。
- 中文界面里的“成员、帖子、简介、讨论”等 UI 文案。

## 地区判断

地区优先由 `group_name` 中的明确地区语义判断，例如：

- `VN` / `Vietnam` / `Việt Nam` -> `VN`
- `Thailand` / `Thai` -> `TH`
- `Indonesia` / `Indo` -> `ID`
- `Mexico` / `México` -> `MX`
- `Laos` / Lao script -> `LA`

未命中群名地区语义时，只允许高确定性语言做辅助映射，例如 Thai、Vietnamese、Indonesian、Malay、Filipino、Lao、Khmer、Burmese。

English、Spanish、Chinese、Arabic、French、Portuguese、Mixed 等语言只作为语言展示，不得单独强制映射国家地区。

## 输出

V3.6.3 不再保存 CSV。第二轮输出：

- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `collision_report.json`
- `audit_stats.json`
- `debug_rows.json`

第二轮自动保存/中断保护输出：

- `phase2_progress.json`: 轻量进度文件，每处理 1 个候选刷新一次；用于观察跑到哪个游戏/第几个候选。
- `phase2_autosave_state.json`: 完整恢复状态；在阶段开始、游戏边界、每条命中有效行、异常退出前刷新，包含已通过筛选的 `staged_rows`、人工复核行和统计。
- `phase2_autosave_summary.json`: 当前局部进度摘要，保持兼容旧观察命令。
- `partial_verified_rows.xlsx`: 已通过筛选行的可读 Excel 暂存文件；启动时先创建表头，每命中 1 条有效群组立即保存。
- `phase2_autosave_last_error.txt`: 仅当暂存 Excel 被打开或写入失败时生成；JSON 自动保存仍会继续。

若第二轮中断，可在同一个 run 目录执行：

```powershell
node .\scripts\finalize_partial_xlsx.js --dir ".\runs\你的run目录" --snapshot-date "2026-05-12"
```

恢复脚本会优先读取 `phase2_autosave_state.json`，保留冲突归属去重逻辑，然后生成可用的 `fb_monitoring_filtered.xlsx`、summary、collision 和 audit 文件。`phase2_progress.json` 只负责观察进度，不作为最终 Excel 的数据源。

Excel 工作簿包含：

- `detail`: 严格通过样本。
- `manual_review`: 人工复核队列。

`detail` 固定列顺序保持兼容：

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits
```

审计字段进入 `manual_review`、`collision_report.json` 和 `debug_rows.json`，包括：

```text
__match_type,__matched_phrase,__source_query,__query_variant_type,__source_is_seed_url,__variant_threshold_applied
```

## 严禁

- 不得读取已导出的 CSV 再重写结果。
- 不得保存独立 CSV 明细或人工复核队列文件。
- 不得把 `manual_review` 混入最终 `detail`。
- 不得把某个游戏的 `connector_x` 特例扩散为所有游戏的通用规则。
- 不得删除原始标题自带的 `X`，例如 `Anime Rangers X`、`Ragnarok X: Next Generation`。
- 不得编造任何采集不到的数据。
