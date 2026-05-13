# FB Game Group Monitor Skill V3.6.3

用于 Facebook 游戏群组两阶段监测的 Codex Skill。

本项目按“先登录、再搜索、再详情采集”的流程运行，支持一次任务同时检索多个游戏。V3.6.3 保留“受控标题变体”机制：自动覆盖低风险的标点/空格写法差异，同时把 `connector_x` 这类高风险变体限制在配置 allowlist 内，避免 Anime、Ragnarok 等多游戏批量任务互相串群。本版将第二阶段自动保存改为“进度 JSON 每候选保存 + 命中行 xlsx 立即保存”，避免每个候选都重写完整 Excel。

## 核心能力

- 第一阶段按每个游戏独立生成搜索计划。
- 自动搜索低风险变体：原始标题、标点归一、冒号/破折号归一、少空格/去空格紧凑标题。
- `connector_x` 默认关闭，只能通过 `title_variant_overrides` 配置开启。
- `seed_group_urls` 可把已知重要群组强制送入第二轮检查，但不会自动进入最终结果。
- 第二阶段进入群组详情页，采集成员规模、今日发帖、上周新增、是否上月已存在等指标。
- 多游戏批量检索时，自动把同批次其他游戏作为兄弟标题排斥。
- 弱相关、仅词根命中、全文命中等记录进入人工复核 sheet，不混入最终明细。
- 默认全球监测，不按语言或地区硬过滤；语言和地区只作为展示与分析字段。
- 语言判断以讨论区前五条可见玩家发言为主，群组名称为辅助。
- “关于这个小组”只在存在用户手写的非 UI 内容时作为最低优先级兜底。
- 地区判断优先看群组名称中的明确地区语义，例如 `VN`、`Vietnam`、`Thailand`、`Indonesia`、`Mexico`、`PH`。
- Excel 输出固定列顺序，`snapshot_date` 和 `group_id` 强制文本格式，活跃指数/规模增速为百分比公式。

## 变体规则

自动启用：

- `canonical`：原始标题。
- `punctuation_normalized`：标点、冒号、破折号归一。
- `compact_spacing`：少空格/去空格紧凑标题，例如 `Allstar TowerDefense`。

必须配置后才启用：

- `connector_x`：例如 `All Star X Tower Defense`。
- `seed_group_urls`：例如指定已知大群 URL。

配置示例：

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

## 输出文件

第二阶段最终生成：

- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `collision_report.json`
- `audit_stats.json`
- `debug_rows.json`

第二阶段运行中会即时生成/刷新：

- `phase2_progress.json`: 轻量进度文件，每处理 1 个候选刷新一次；用于观察当前跑到哪个游戏/第几个候选。
- `phase2_autosave_state.json`: 完整恢复状态；在阶段开始、游戏边界、每条命中有效行、异常退出前刷新，包含已通过筛选的 `staged_rows`、人工复核行和统计。
- `phase2_autosave_summary.json`: 当前局部摘要，保持兼容旧观察命令。
- `partial_verified_rows.xlsx`: 已通过筛选行的可读暂存表；启动时先创建表头，每命中 1 条有效群组就立即保存。
- `phase2_autosave_last_error.txt`: 仅当暂存 Excel 写入失败时出现；通常是文件被 Excel 打开占用。

Excel 工作簿包含：

- `detail`: 严格通过的最终明细。
- `manual_review`: 人工复核队列。

不再生成任何独立 CSV 明细或人工复核队列文件。

## Excel 明细列

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits
```

Excel 格式规则：

- `snapshot_date` 写为文本，例如 `2026-05-06`。
- `group_id` 写为文本，避免长数字变成科学计数法。
- `活跃指数=当日新帖/社群规模` 使用公式 `=IFERROR(Ix/Hx,"")`。
- `规模增速=上周新增/(社群规模-上周新增）` 使用公式 `=IFERROR(Jx/(Hx-Jx),"")`。
- 两个公式列均为百分比格式，保留 2 位小数。

## 语言与地区规则

语言判断优先级：

1. 讨论区前五条可见玩家发言。
2. 群组名称。
3. 用户手写的“关于这个小组”非 UI 文本。

不得把 Facebook 界面语言、按钮、导航、固定结构文案、空 about 区块结构文字当作语言证据。

地区判断优先级：

1. 群组名称里的明确地区/国家语义。
2. 高确定性语言到地区的辅助映射，例如 Thai -> TH、Vietnamese -> VN、Indonesian -> ID。
3. 无法确定时留空。

English、Spanish、Chinese、Arabic、French、Portuguese、Mixed 等语言只作为语言展示，不单独强制映射国家地区。

## 使用方法

安装依赖：

```powershell
npm install
```

打开 Chrome 并手动登录 Facebook：

```powershell
npm run login
```

第一阶段：

```powershell
npm run phase1 -- --games "All Star Tower Defense" --out-dir ".\runs\demo" --config ".\runs\demo\task_config.json" --cdp "http://127.0.0.1:9222"
```

第二阶段：

```powershell
npm run phase2 -- --index ".\runs\demo\phase1_index.json" --config ".\runs\demo\task_config.json" --out-xlsx ".\runs\demo\fb_monitoring_filtered.xlsx"
```

第二阶段默认采用更轻的即时保存方式：

- 每处理 1 个候选，刷新 `phase2_progress.json` 和 `phase2_autosave_summary.json`，不重写 xlsx。
- 只有当某个群组通过全部筛选并进入有效结果时，才立刻刷新 `partial_verified_rows.xlsx` 和完整 `phase2_autosave_state.json`。
- 这样既保留断点进度，又避免“每个候选都重写完整 Excel”的额外开销。

如果中途断电、Ctrl+C、浏览器崩溃或脚本报错，不要删除 run 目录，直接用自动保存状态恢复当前已跑出的结果：

```powershell
node .\scripts\finalize_partial_xlsx.js --dir ".\runs\demo" --snapshot-date "2026-05-12"
```

恢复脚本优先读取 `phase2_autosave_state.json`；如果没有该文件，才回退读取 `partial_verified_rows.xlsx`。`phase2_progress.json` 主要用于观察进度，不直接作为最终 Excel 的数据源。

一键流程：

```powershell
npm run monitor -- -Games "Anime Guardians,Anime Last Stand,Anime Overload,Anime Rangers X,Anime Tactical Simulator,Anime Vanguards" -Config ".\runs\demo\task_config.json"
```

## 仓库结构

- `SKILL.md`: Codex Skill 工作流说明。
- `scripts/`: 登录、第一阶段、第二阶段脚本。
- `references/`: 判定规则、Excel schema、质量检查清单。
- `assets/`: 配置模板。
- `agents/`: 可选 agent 配置。
- `package.json`: Node.js 依赖与命令。

## GitHub 上传清单

建议上传：

- `SKILL.md`
- `README.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`
- `package.json`
- `package-lock.json`
- `.gitignore`

不要上传：

- `node_modules/`
- `runs/`
- Facebook 输出结果文件
- 浏览器缓存、Cookie、登录态、截图、临时文件

## 隐私说明

本项目不应包含 Facebook 账号、Cookie、token 或任何登录态文件。所有采集都应通过用户手动登录的浏览器会话执行。
