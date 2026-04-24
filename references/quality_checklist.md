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

## 抽检重点
- [ ] 同一 `group_url` 在最终 CSV 中只出现一次
- [ ] `LINE Rangers` 不应大面积吸入 `LINE Idle Rangers`
- [ ] `Soul Land` 各子标题之间不应互相串群
- [ ] `Ragnarok` 各子标题不应仅靠词根互相命中
- [ ] `group_name` 命中兄弟游戏标题的记录，不应进入最终 CSV
- [ ] `exact_phrase_in_full_text` 的记录，应进入 `manual_review_queue.csv` 而非最终 CSV
- [ ] `region` 应来自 `language_to_region` 配置映射
- [ ] 若配置了 `allowed_language_signals` / `allowed_regions`，最终输出应符合配置限制
