---
name: fb-group-monitor-v4.0.0
description: 用于 Facebook 游戏群组两阶段监测的严格技能。V4.0.0 支持 Codex 后台启动登录态验证、第一轮抓取和第二轮抓取，启动后应立即把控制权还给用户；第二轮默认每 30 分钟写入/输出 Codex 进度汇报；最终 Excel 报告生成后自动关闭 Chrome；只有用户明确要求时才可在完成后自动关机。
---

# Facebook Group Monitor V4.0.0

## 必须先读

- `SKILL.md`
- `references/judgement_rules.md`
- `references/quality_checklist.md`
- `references/xlsx_schema.md`
- `assets/task_config.template.json`


## Codex 后台运行规则

登录态验证、第一轮抓取和第二轮抓取都必须优先用后台启动脚本运行，避免 Codex 前台命令长期占用聊天输入框：

```powershell
# 打开 Chrome 登录窗口
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task login

# 后台验证登录态
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task validate-login -RunDir ".\runs\demo"

# 后台第一轮
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task phase1 -Games "GAME A,GAME B" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"

# 后台第二轮；默认 30 分钟刷新/输出一次 codex_progress_report，最终报告生成后自动关闭 Chrome
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task phase2 -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"

# 只有当用户明确要求“完成后关机 / 跑完关机”时，才允许加入 -ShutdownAfterComplete
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task phase2 -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownAfterComplete -ShutdownDelaySeconds 60
```

后台启动命令返回 `background_task.json`、PID、stdout/stderr 日志路径和 run 目录后，Codex 必须立即回复用户“已在后台开始”，不得继续等待抓取结束。用户可继续输入文本。

查看后台状态：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show_background_task_status.ps1 -RunDir ".\runs\demo"
```

## Codex 长任务进度汇报

本 Skill 在第一轮和第二轮脚本中内置 Codex 进度汇报器：

- 第二轮默认每 30 分钟向 stdout 日志输出一行 JSON，字段 `event` 为 `codex_progress_report`，其中 `message` 是可直接转述给用户的中文进度摘要。
- 同步刷新 `codex_progress_report.json`，默认位于当前 run 目录。
- 第二轮汇报当前游戏、当前候选序号、累计处理候选数、已暂存有效行、最近候选状态和输出文件位置。
- 第一轮仍保留相同进度能力，用于需要时观察当前游戏、搜索变体、滚动轮次和候选数。
- 可通过命令行 `--progress-report-every-minutes 30`、配置项 `progress_report_every_minutes` 或环境变量 `CODEX_PROGRESS_REPORT_EVERY_MINUTES` 调整间隔；设为 `0` 可关闭定时汇报。

## 完成后关机规则

- 默认禁止自动关机；`assets/task_config.template.json` 中 `shutdown_after_complete` 必须保持 `false`。
- 只有用户在提示词中明确要求“完成后关机 / 跑完关机 / 生成报表后关机”等含义时，Codex 才能传入 `-ShutdownAfterComplete` 或 `--shutdown-after-complete true`。
- 触发顺序必须是：第二轮完整报表写入成功 -> 关闭 Chrome -> 写入 `codex_task_complete.json` -> 执行 `shutdown.exe /s /t 60`。
- 默认延迟 60 秒关机；如需取消，让用户在关机倒计时内执行 `shutdown.exe /a`。
- 若用户同时要求保留 Chrome，例如 `--no-close-chrome true`，则不得关机。

## 登录阶段

1. 先运行 `scripts/open_chrome_9222.ps1` 或后台 `start_background_task.ps1 -Task login`。
2. 提示用户手动登录 Facebook。
3. 用户回复“已登录”后，先运行 `validate_login_state.js` 或后台 `start_background_task.ps1 -Task validate-login` 验证登录态。
4. 验证结果为 `logged_in` 之前，不得搜索、采集、分析或生成报告。

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

V4.0.0 的 `region` 采用“具体国家/地区/属地识别 -> 业务区域归并输出 -> 同大区多命中折叠”的三层规则。

单一国家/地区命中时：

- 东亚与东南亚按自身国家/地区输出，例如 `JP`、`KR`、`TW`、`TH`、`VN`、`ID`、`MY`、`SG`、`PH`。
- `Middle East`、`Central Asia`、`South Asia`、`North America`、`LATAM`、`Africa`、`EUR`、`Oceania` 按业务大区归并。
- `BR` 单列；`TR`、`NL`、`DE`、`FR`、`IT`、`PL`、`RU` 单列。

多个国家/地区同时命中时：

- 如果所有命中项属于同一个业务大区，则输出对应大区。例如 `MY + SG`、`TH + VN`、`ID + PH` 输出 `SEA`；`HK + TW` 输出 `EA`；`DE + FR` 输出 `EUR`。
- 如果命中项跨业务大区，则视为 `keyword_conflict` 并留空。例如 `UAE + PH`、`US + BR`、`JP + TH` 不强行归并。
- 同大区折叠时，`__region_source` 输出 `country_keyword_same_business_region` 或 `region_keyword_same_business_region`，`__region_keyword_hits` 保留原始命中详情。

未命中群名地区语义时，仅允许高确定性语言辅助映射：Thai -> `TH`、Vietnamese -> `VN`、Indonesian -> `ID`、Malay -> `MY`、Filipino -> `PH`、Lao -> `LA`、Khmer -> `KH`、Burmese -> `MM`、Arabic/Persian -> `Middle East`。

English、Spanish、Chinese、French、Portuguese、Mixed 等语言只作为语言展示，不得单独强制映射国家地区。Arabic / Persian 只在国家未知时辅助归入 `Middle East`；若明确识别到非洲国家，则优先输出 `Africa`，Egypt 例外归入 `Middle East`。

## 输出

V4.0.0 不再保存 CSV。第二轮输出如下，完整 Excel 报告生成后默认自动关闭 Chrome：

- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `collision_report.json`
- `audit_stats.json`
- `debug_rows.json`

如需保留 Chrome 不关闭，可在第二轮命令中加 `--no-close-chrome true`，或在配置中设置 `close_chrome_after_report: false`。

第二轮自动保存/中断保护输出：

- `codex_progress_report.json`: Codex 进度汇报快照；第二轮默认每 30 分钟刷新并向 stdout 日志输出一次 `codex_progress_report` 事件。
- `phase2_progress.json`: 轻量进度文件，每处理 1 个候选刷新一次；用于观察跑到哪个游戏/第几个候选。
- `phase2_autosave_state.json`: 完整恢复状态；在阶段开始、游戏边界、每条命中有效行、异常退出前刷新，包含已通过筛选的 `staged_rows`、人工复核行和统计。
- `phase2_autosave_summary.json`: 当前局部进度摘要，保持兼容旧观察命令。
- `partial_verified_rows.xlsx`: 已通过筛选行的可读 Excel 暂存文件；启动时先创建表头，每命中 1 条有效群组立即保存。
- `phase2_autosave_last_error.txt`: 仅当暂存 Excel 被打开或写入失败时生成；JSON 自动保存仍会继续。
- `codex_task_complete.json`: 第二轮最终状态文件，记录完整报表是否生成、Chrome 是否关闭、是否请求关机以及关机命令结果。

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
