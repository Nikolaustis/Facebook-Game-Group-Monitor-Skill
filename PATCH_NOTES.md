# FB Group Monitor Skill V3.6.3 Patch Notes

本补丁解决：第二轮详情采集虽然已有自动保存，但写入策略过重，容易在长任务中增加额外 I/O 开销。

## 核心变化

1. `scripts/phase2_collect_details.js`
   - 新增 `phase2_progress.json`：每处理 1 个候选刷新一次，只保存轻量进度，不携带完整行数据。
   - `partial_verified_rows.xlsx` 改为：阶段启动时先创建表头；每命中 1 条有效群组后立即保存。
   - `phase2_autosave_state.json` 改为完整恢复状态：阶段开始、游戏边界、每条命中有效行、异常退出前刷新。
   - 不再对每个被跳过/被过滤候选都重写完整 xlsx。
   - 保留 `phase2_autosave_summary.json`，兼容旧的进度观察命令。
   - 保留 `phase2_autosave_last_error.txt`，当 xlsx 被 Excel 打开占用时记录错误；JSON 自动保存仍继续。

2. `scripts/finalize_partial_xlsx.js`
   - 继续优先读取 `phase2_autosave_state.json`。
   - 若完整状态不可用，仍可从 `partial_verified_rows.xlsx` 恢复已经命中的有效行。

## 为什么这样更快

旧策略接近“每处理一个候选，就重写完整 xlsx”。
新策略是“每个候选只写小 JSON；只有通过全部筛选的有效群组才写 xlsx”。

Facebook 页面加载、重试和 about 失败仍是主要耗时来源，但本补丁可以减少大量无效候选造成的 Excel 重写开销。

## 中断后的恢复命令

在同一个 skill 根目录执行：

```powershell
node .\scripts\finalize_partial_xlsx.js --dir ".\runs\你的run目录" --snapshot-date "2026-05-12"
```

## 覆盖文件

本补丁包含以下文件，可直接解压覆盖原 skill：

- `SKILL.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `scripts/phase2_collect_details.js`
- `scripts/finalize_partial_xlsx.js`
- `PATCH_NOTES.md`
