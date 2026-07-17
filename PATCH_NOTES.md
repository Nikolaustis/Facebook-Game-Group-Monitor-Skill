# V6.2.2

- 默认完成后不关机；不再依赖 task_config 中固定日期或历史关机字段。
- 新增 `-ShutdownMode none|after_complete|before_deadline`、`-ShutdownDeadline` 和 `-ShutdownInstruction`。
- Codex 根据用户在文本框中的自然语言动态生成本次运行 `shutdown_policy.json`；用户无需手工编辑文件。
- 任务计划程序、隐藏 direct fallback、系统重启续跑和最终关机 watcher 统一读取该运行专属策略。
- `before_deadline` 强制要求带时区的绝对时间；示例日期不可复用。
- 保留 `-ShutdownAfterComplete`、`-ShutdownBefore` 兼容入口，但新任务优先使用关机模式。
- 计划任务及关机兜底任务执行后仍自动删除。
- 关机 watcher 等待 PowerShell runner（而非仅等待 Node）退出，并在关机前再次清理主计划任务。
- 一次性关机兜底任务改为“先自删任务定义，再执行 shutdown.exe”，避免立即关机后遗留任务。
- 运行中重新提交关机意图时，phase2 在最终完成阶段重新读取 `shutdown_policy.json`；无效策略按不关机处理。

# V6.2.1

- 修复完成前截止时间关机：新增 `-ShutdownBefore` / `shutdown_before`，不再要求 Codex临时生成独立 Node watcher。
- 强制关机改为隐藏 PowerShell watcher 调用 `System32\shutdown.exe`，提供直接调用、`Start-Process` 与自删除一次性计划任务三级兜底。
- 修复 Node `spawnSync shutdown.exe EPERM` 导致完成后未关机的问题。
- 群名中明确的泰语、越南语、印尼语等证据优先于少量讨论帖采样，避免泰语群被判 English、`Việt Nam` 群被判 Arabic。
- GeoNames 对 timeout、网络错误、解析错误、HTTP 408/425/429/5xx 默认重试 2 次并记录 `external_geocoder_retries`。
- 所有临时关机计划任务执行后自动删除。

# V6.2.0 补丁说明：修复 WScript 空转与任务计划程序启动误判

## 问题

V6.1.0 在实机上出现 `wscript.exe` 驻留，但没有启动 `scheduled_phase2_runner.ps1`，也没有 runner 状态、power guard 或 stdout/stderr。旧启动器同时转发脚本、Manifest 和 TaskName，多层 Windows 参数解析缺少启动后健康检查；任务显示 Running 时还会被误判为有效实例。

## 修改

- 每次启动生成一个无参数 bootstrap 脚本，WScript 只传递该脚本路径。
- WScript 通过 WMI 隐藏创建 PowerShell，失败时再使用 `WScript.Shell.Run`，并写入 launcher trace。
- `phase2:bg` 等待 runner 状态和存活 PID，默认最长 45 秒。
- 发现“任务 Running、runner 不存在”时自动停止并删除旧任务，不再返回 `already_running`。
- WScript 链失败后自动切换到任务计划程序直接隐藏 PowerShell；再次失败则删除任务并使用无窗口直接进程兜底。
- 新增 bootstrap、launcher 与启动尝试诊断文件。
- 任务正常结束后同步删除临时 bootstrap；任务与 manifest 的自删除逻辑保留。

## 兼容性

- 基于 V6.1.0 累计升级，不改变已有完整 checkpoint、GeoNames、兄弟游戏、预筛和 XLSX 规则。
- 不新增 npm 依赖。
- 可直接使用原 RunDir 从完整 checkpoint 续跑。

# V6.1.0 补丁说明：任务计划程序、逐候选完整断点与严格关机门槛

## 修复的问题

1. Windows Update 重启会直接终止 PowerShell、Node 和 Chrome，旧后台进程无法自动恢复。
2. V5.8.0 允许 `phase2_progress.json` 的游标领先完整 autosave，恢复后可能跳过尚未持久化的 `manual_review` 数据。
3. 运行期间没有持续防睡眠与取消待执行关机/重启的保护。
4. 旧版关机 watcher 启动失败时存在直接关机回退，严格性不足。
5. 长任务使用任务计划程序后，若不清理会留下冗余任务。

## 修改

- `phase2:bg` 默认创建 Windows 任务计划程序任务，附加立即启动与 `AtLogOn` 触发器。
- 系统重启中断时，任务保留；用户登录后自动启动 Chrome 并读取同一完整 checkpoint 续跑。
- 每个候选处理后原子保存完整 `staged_rows + manual_review_rows + stats + cursor`；候选尚在处理中发生异常时，checkpoint 仍停留在上一条完整候选，下次会重跑该条而不会误跳过。
- 恢复只使用完整 checkpoint 游标，轻量 progress 不再推进恢复位置。
- 新增 `runtime_power_guard.ps1`：保持系统唤醒，并周期性尝试 `shutdown.exe /a`。
- 新增同一 RunDir 的确定性任务名和互斥锁，避免重复实例。
- 正常执行结束后立即注销任务；失败则由延迟清理进程再次注销。任务删除成功后删除 manifest。
- 完成后关机增加八项严格校验；关机 watcher 失败时不再直接回退关机。
- `show_background_task_status.ps1` 新增任务计划程序、runner 和 power guard 状态。

## 兼容性

- 基于 V5.8.0 累计升级。
- 不新增 npm 依赖。
- 可读取旧 V5.x checkpoint；首次 V6.0 写入后升级为 checkpoint version 4。
- `phase2:direct-bg` 保留旧式后台启动，仅用于排查任务计划程序问题。

# V5.8.0 补丁说明：GeoNames 类型兼容与第二轮自动续跑

## 修复的问题

1. GeoNames `alternateNames` 偶尔返回对象数组，旧代码直接传入 `clean(...).replace`，导致第二轮进程崩溃。
2. 后台重新执行 `phase2:bg` 时未显式传 `--resume true`，旧版本即使存在 autosave 也会从第 1 条重跑。
3. 完整 autosave 仅在接受行、游戏边界或紧急退出时写入；逐候选进度游标可能更靠后，旧恢复逻辑没有合并二者。

## 修改

- 新增安全标量转换与 GeoNames alternate name 递归展开。
- GeoNames 名称匹配和置信度计算统一使用安全名称列表。
- 同一 index 的未完成 checkpoint 默认自动恢复。
- 结合 `phase2_autosave_state.json` 的结果行与 `phase2_progress.json` 的最新处理游标。
- 逐候选进度文件同步保存 stats。
- 后台启动器新增 `-FreshStart`，用于明确放弃旧断点。
- 新增恢复审计字段 `phase2_resume_enabled`、`phase2_resume_source`。

## 兼容性

- 基于 V5.7.0 累计升级。
- 不新增 npm 依赖。
- 旧 V5.x checkpoint 可读取。

# V5.7.0 补丁说明：第二轮群名预筛与 About 访问加速

## 核心修改

1. 第二轮在打开 `/about` 和讨论页之前，优先使用第一轮候选卡片的 `group_name` 做本地相关性预筛。
2. 群名完整且不命中目标标题、别名、受控变体、兄弟标题或 IP root 时，直接跳过。
3. 强命中继续进入完整采集；IP root/兄弟标题等弱命中默认保留到人工复核链路。
4. seed URL、缺失群名、截断群名视为无法预判，仍打开 About，避免错误漏采。
5. 新增 `phase2_name_prefilter` 配置和预筛审计统计。
6. 不改变 About 后的正式相关性、活跃阈值、语言、地区、GeoNames、冲突归属和 Excel 输出规则。

## 新增统计

- `phase2_name_prefilter_enabled`
- `phase2_name_prefilter_checked`
- `phase2_name_prefilter_passed_strong`
- `phase2_name_prefilter_passed_manual_review`
- `phase2_name_prefilter_inconclusive`
- `phase2_name_prefilter_skipped_no_match`
- `phase2_name_prefilter_skipped_manual_review`
- `about_avoided_by_name_prefilter`

## 兼容性

- 基于 V5.6.0 累计升级。
- 默认保留人工复核型弱命中，不降低现有召回。
- 不新增 npm 依赖。


## V6.1.0：任务计划程序全链路无窗口启动

- 任务计划程序不再直接执行 `powershell.exe`，改由 Windows GUI 子系统的 `wscript.exe` 调用 `scripts/hidden_powershell_launcher.vbs`。
- WScript 以窗口样式 `0` 启动并等待 scheduled runner，因此任务状态仍会保持为“正在运行”，但不会生成可见的空白 PowerShell 控制台。
- `runtime_power_guard.ps1` 与延迟任务清理进程使用 `ProcessStartInfo.CreateNoWindow=true` 启动，避免子 PowerShell 短暂闪窗。
- Chrome 启动脚本在已隐藏的 scheduled runner 内直接执行，不再额外创建 `powershell.exe` 子控制台。
- `phase2:direct-bg` 保持原有隐藏 `Start-Process` 路径；本次故障对应的任务计划程序路径已改为 WScript 全无窗口启动。
- 正常结束后的计划任务自删除、重启后登录续跑、完整 checkpoint 和严格关机门槛保持不变。

旧 V6.0.0 任务若已经在运行，覆盖文件不会改变该任务已注册的 Action。应先让旧任务结束，或停止并删除旧任务，再使用 V6.1.0 重新启动第二轮。新注册任务的 Action 应显示为 `wscript.exe`，而不是 `powershell.exe`。
