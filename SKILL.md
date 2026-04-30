---
name: fb-group-monitor-v3.4
description: 用于 Facebook 游戏群组两阶段监测的严格技能。用户提到“FB 群组采集/监测/输出 CSV/Excel/多游戏批量/manual_review_queue/collision_report/先登录再采集”时使用。先执行登录阶段；在用户回复“已登录”前不要搜索、采集、分析或生成报告。登录后按两阶段流程执行，并输出 CSV、Excel、中文摘要、manual_review_queue.csv、collision_report.json、audit_stats.json。
---

# Facebook Group Monitor V3.4

## 核心升级
- 支持 Unicode 安全文件名与标题匹配，减少泰语等非 ASCII 标题的误覆盖和误判。
- 新增同系列兄弟游戏硬排斥，且更长、更具体的完整标题优先。
- `exact_phrase_in_full_text` 降级为人工复核，不直接进入最终结果。
- 语言与地区默认不设硬限制；`region` 优先用地区关键词识别，未命中再回退到 `language_to_region`。
- `language_signal` 必须基于群组名称 + 关于这个小组的非 UI 文本 + 讨论区前五条可见玩家发言判断；不得把 Facebook 界面语言、按钮、导航、固定 UI 文案当作群组语言。
- `language_signal` 使用多语言证据评分：字符脚本、群名强信号、语言关键词、常见功能词共同投票；英文只作为弱兜底，不能压过法语/西语/葡语等拉丁语系证据。
- `region` 必须优先由群组名称中的明确地区语义判断；不得从 about 整页文本、Facebook UI 或泛文本里捞取 `US` / `UK` 等地区。
- `/about` 抓取增强多 URL、多等待和正文回退提取，降低 `about_failed`。

## 先读哪些文件
- 先读 [SKILL.md](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/SKILL.md)
- 再读 [references/judgement_rules.md](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/references/judgement_rules.md)
- 再读 [references/quality_checklist.md](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/references/quality_checklist.md)
- 如需配置别名、兄弟游戏、地区关键词，读 [assets/task_config.template.json](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/assets/task_config.template.json)

## 执行流程
### 1. 登录阶段
- 运行 [scripts/open_chrome_9222.ps1](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/scripts/open_chrome_9222.ps1)
- 提示用户手动登录 Facebook
- 在用户回复 `已登录` 之前，不执行搜索、采集、分析、报告生成

### 2. 第一轮候选采集
- 只使用用户给的原始游戏名搜索，不扩展词
- 运行 [scripts/phase1_collect_candidates.js](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/scripts/phase1_collect_candidates.js)
- 达到深翻停止条件后，必须先询问：
  - `可以停止，继续 / 继续深翻`

### 3. 第二轮详情采集与筛选
- 只有在用户确认继续后，才运行 [scripts/phase2_collect_details.js](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/scripts/phase2_collect_details.js)
- 只对卡片成员数 `>= 100` 的群进入 `/about`
- `/about` 失败的记录不输出到最终 CSV
- 同一个 `group_url` 只允许归属给一个游戏；并列最高分冲突写入 `collision_report.json`

## V3.4 筛选要点
- `group_name` 完整命中目标标题，视为强正样本
- `group_name` 命中兄弟游戏标题，直接负判
- `group_name` 同时命中多个完整标题时，优先更长、更具体的标题
- `exact_phrase_in_full_text` 不直接进最终 CSV，而是进入 `manual_review_queue.csv`
- `group_name` 只命中 IP 大词根、未命中目标完整标题时，进入 `manual_review_queue.csv`
- `language_signal` 由 `group_name` + 关于这个小组的非 UI 文本 + 讨论区前五条可见玩家发言识别；排除 Facebook UI 文案，不使用 about 整页 UI 文本判语言
- 拉丁语系语言不能只靠英文字符数量判断；需综合 French/Spanish/Portuguese/German/Italian/Dutch/Polish/Turkish/Indonesian/Malay/Filipino/Vietnamese 等语言画像评分
- `region` 优先只由 `group_name` 中的明确地区语义识别；未命中时仅允许 Thai/Vietnamese/Indonesian/Malay/Filipino 等高确定性语言做辅助映射
- 默认全球可收集；只有配置了 `allowed_language_signals` 或 `allowed_regions` 才进行硬过滤
- 活跃阈值满足其一即可：
  - `today_posts >= threshold`
  - `week_new_fans >= threshold`

## 输出文件
- `fb_monitoring_filtered.csv`
- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `manual_review_queue.csv`
- `collision_report.json`
- `audit_stats.json`

## 推荐入口
- 批量流程可直接走 [scripts/run_multi_games_v2.ps1](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/scripts/run_multi_games_v2.ps1)
- 详细字段顺序见 [references/csv_schema.md](C:/Work/Crawler/fb-group-monitor-skill-v2/fb-group-monitor-skill-v2/references/csv_schema.md)
