# 质量检查清单（V3）

## 运行前
- [ ] 已完成 Facebook 登录
- [ ] 游戏名列表确认无误
- [ ] threshold 已确认（默认 10）

## 第一轮后
- [ ] 每个游戏都生成了 `phase1_*_candidates.json`
- [ ] 每个游戏都生成了 `phase1_*_stats.json`
- [ ] 已人工确认是否停止深翻

## 第二轮后
- [ ] 输出 CSV / XLSX / summary.json / manual_review_queue.csv 成功生成
- [ ] 检查 `collision_report.json` 是否出现大量并列冲突
- [ ] 检查 `audit_stats.json` 中 `dropped_collision`、`dropped_lang_region` 是否异常偏高
- [ ] 检查 `manual_review_queue.csv` 是否已收集 full_text 命中、兄弟标题命中、IP 大词根命中记录
- [ ] 抽查 `language_signal` 是否来自群组名称 + 关于这个小组的非 UI 文本 + 讨论区前五条可见玩家发言，而不是 about 整页 UI 文本或 Facebook 中文/英文界面 UI 文案
- [ ] 抽查拉丁语系群组是否被英文游戏词误判为 `English`；若群名/about/帖子出现法语、西语、葡语等功能词，应优先识别对应语言

## 抽检重点
- [ ] 同一 `group_url` 在最终 CSV 中只出现一次
- [ ] `LINE Rangers` 不应大面积吸入 `LINE Idle Rangers`
- [ ] `Soul Land` 各子标题之间不应互相串群
- [ ] `Ragnarok` 各子标题不应仅靠词根互相命中
- [ ] `group_name` 命中兄弟游戏标题的记录，不应进入最终 CSV
- [ ] `exact_phrase_in_full_text` 的记录，应进入 `manual_review_queue.csv` 而非最终 CSV
- [ ] `region` 应优先来自群组名称中的明确地区语义关键词；不得从 about 整页文本、UI 文案或泛文本中推断 `US` / `UK`
- [ ] English / Spanish / Chinese / Arabic 只能作为语言展示，不得单独映射成国家地区
- [ ] 若配置了 `allowed_language_signals` / `allowed_regions`，最终输出应符合配置限制
