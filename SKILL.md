# FB Group Monitor Skill V3.6.4 Patch Notes

本补丁在 V3.6.3 的自动保存机制基础上，新增 Codex 长任务定时进度汇报。

## 核心变化

1. 新增 `scripts/progress_reporter.js`
   - 第一轮和第二轮共用的 Codex 进度汇报器。
   - 默认每 30 分钟输出一行 `event: codex_progress_report` 的 JSON。
   - 同步刷新 run 目录下的 `codex_progress_report.json`。
   - `message` 字段为中文摘要，可直接转述给用户。

2. `scripts/phase1_collect_candidates.js`
   - 接入定时汇报器。
   - 汇报当前游戏、当前搜索变体、滚动轮次、当前查询候选数、总候选估算。
   - 支持 `--progress-report-every-minutes`、`task_config.json` 的 `progress_report_every_minutes`、环境变量 `CODEX_PROGRESS_REPORT_EVERY_MINUTES`。

3. `scripts/phase2_collect_details.js`
   - 接入定时汇报器。
   - 汇报当前游戏、当前候选序号、累计处理候选数、已暂存有效行、最近候选状态和主要输出文件。
   - 保留原有 `phase2_progress.json`、`phase2_autosave_state.json`、`partial_verified_rows.xlsx` 的中断保护逻辑。

4. `SKILL.md`、`README.md`、`assets/task_config.template.json`
   - 增加 Codex 进度汇报说明。
   - 配置模板新增 `progress_report_every_minutes: 30`。

## 使用方式

默认无需额外参数，长任务运行满 30 分钟后会自动汇报。

如需调整间隔：

```powershell
node .\scripts\phase2_collect_details.js --index ".\runs\demo\phase1_index.json" --progress-report-every-minutes 15
```

如需关闭：

```powershell
node .\scripts\phase2_collect_details.js --index ".\runs\demo\phase1_index.json" --progress-report-every-minutes 0
```

## 覆盖文件

本补丁包含以下文件，可直接解压覆盖原 skill：

- `SKILL.md`
- `README.md`
- `PATCH_NOTES.md`
- `package.json`
- `package-lock.json`
- `assets/task_config.template.json`
- `scripts/progress_reporter.js`
- `scripts/phase1_collect_candidates.js`
- `scripts/phase2_collect_details.js`
