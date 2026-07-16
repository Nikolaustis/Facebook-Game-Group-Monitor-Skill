# V6.0.0 补丁说明：任务计划程序、逐候选完整断点与严格关机门槛

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
