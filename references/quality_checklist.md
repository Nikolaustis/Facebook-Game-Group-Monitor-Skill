# 质量检查清单

## 输入与启动

- [ ] index、config、shutdown policy 和所有 candidate JSON 已通过 `validate_phase2_inputs.js`。
- [ ] JSON 编码检测结果可接受，UTF-8 BOM 或 UTF-16 不会导致解析失败。
- [ ] `scheduled_phase2_runner_status.json` 为 `phase2_running`。
- [ ] `startup_verified=true`，且存在启动后新写入的 `phase2_progress.json`。
- [ ] 启动失败时记录了退出码和 stderr tail。

## 第一轮

- [ ] 每个游戏独立搜索。
- [ ] 未自动扩展为过宽 IP 词根。
- [ ] source query 与变体类型完整保存。
- [ ] 深翻停止经过用户确认。

## 第二轮

- [ ] 群名预筛发生在 About/讨论页访问之前。
- [ ] 明显无关候选被跳过。
- [ ] seed、缺名、截断群名仍进入页面核验。
- [ ] 每个候选完成后完整保存 checkpoint。
- [ ] 断点恢复位置不超过完整 checkpoint。

## 相关性与兄弟游戏

- [ ] 完整标题、紧凑标题和受控变体分别审计。
- [ ] 兄弟标题排斥优先于弱命中。
- [ ] IP root-only 和 full-text-only 未混入 `detail`。
- [ ] 同一 URL 明确命中多个游戏时，各游戏均保留；同一 URL、同一游戏仅保留最高分记录。

## 语言与地区

- [ ] 群名中的明确语言/国家证据未被无关讨论样本覆盖。
- [ ] UI 文案未被识别为玩家语言。
- [ ] `SEA`、`MY`、`MY/SG` 和跨大区冲突按规则处理。
- [ ] 风险词先经语义裁决或安全过滤，再决定是否调用 GeoNames。
- [ ] `Drama` 等高歧义词未产生错误地点查询。
- [ ] GeoNames 查询不包含游戏名残词、交易词或普通社群词。

## 模型链

- [ ] 自定义 API 优先于 Codex CLI。
- [ ] API 请求包含 JSON/Schema要求和供应商专用参数。
- [ ] 低置信度 API 结果继续回退。
- [ ] Codex CLI 为独立可执行 CLI，不是 WindowsApps 内部别名。
- [ ] 模型不可用时采集继续回退本地规则。

## XLSX

- [ ] `detail` 和 `manual_review` 公共列顺序一致。
- [ ] 人工复核专属列位于公共列之后。
- [ ] 活跃指数和规模增速为百分比格式。
- [ ] 上传基础包中的字段顺序未被补丁重排。
- [ ] 最终 workbook、summary、collision、audit、debug rows 均存在。

## 完成与关机

- [ ] Chrome 在最终文件校验后关闭。
- [ ] 主计划任务执行后自动删除。
- [ ] 默认不关机。
- [ ] 仅在用户本轮指令明确要求且截止时间有效时关机。
- [ ] 关机前完成文件、checkpoint、progress 和 token 均通过校验。

## 接力任务

- [ ] 使用 `queue_phase2_after_current.ps1`，没有临时拼接等待脚本。
- [ ] 当前任务完成状态经过 finalization 验证。
- [ ] 目标输入预检通过。
- [ ] 接力启动经过实际进度健康检查。
- [ ] 启动失败按配置重试并写入 `phase2_handoff_status.json`。

## V6.6.2 关键检查

- [ ] 同一 URL 同时明确命中多个目标游戏时，每个游戏均保留一条 detail。
- [ ] 同一 URL、同一游戏的重复行只保留最高分记录。
- [ ] `collision_report.json` 使用 `keep_each_matched_game` 或 `deduplicate_same_game_keep_highest_score`。
- [ ] 关机前生成 `shutdown_preflight_verification.json`。
- [ ] 大型 checkpoint 的 `checkpoint_readable` 与 `checkpoint_finalized` 由 Node verifier 给出。
- [ ] verifier 失败时记录 read_errors/stdout/stderr，且不得关机。
