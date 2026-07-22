# 监测流程标准

## 登录

- 必须先验证 Facebook 登录状态。
- 未登录时不得开始搜索、采集或报告输出。

## 第一轮

- 以用户指定游戏及受控标题变体采集候选。
- 达到深翻停止条件后等待用户确认。
- 为每个游戏保留独立候选和来源审计。

## 第二轮

- 先预解析全部 JSON 输入。
- 先进行群名相关性预筛，再访问 About 和讨论页。
- 页面未明确出现的字段保持空白，不猜测。
- 每个候选后保存完整 checkpoint。
- 计划任务启动必须由新进度 checkpoint 证明，而非只看 PID。

## 无人值守

- 使用任务计划程序隐藏运行并防止自动睡眠。
- 系统重启后从完整 checkpoint 恢复。
- 正常结束后删除本次计划任务。
- 接力批次使用标准 handoff 脚本并验证真实启动。

## 输出

- 正式结果与人工复核分 Sheet。
- 同一 `group_url + game_name` 正式输出最多一条；多游戏群组可在不同游戏下分别保留。
- 生成 summary、collision、audit 和 debug rows。
- 完成后关闭 Chrome。

## 关机

默认不关机。仅根据用户当前指令生成本轮策略；超过截止时间或任何完成校验失败时保持开机。

## 多游戏群组归属

最终明细以 `group_url + game_name` 为唯一键。同一 Facebook 群组明确命中多个目标游戏时，应分别保留到每个游戏；只对同一 URL、同一游戏的重复候选保留最高分记录。

## 关机最终校验

大型 `phase2_autosave_state.json` 必须由 Node.js 的 `scripts/verify_shutdown_state.js` 解析。PowerShell 协调器只读取小型 `shutdown_preflight_verification.json`，不得将 `ConvertFrom-Json` 解析大型 checkpoint 的结果作为权威依据。
