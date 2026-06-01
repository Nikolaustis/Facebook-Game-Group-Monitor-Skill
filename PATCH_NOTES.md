# Patch Notes - V3.6.7

本补丁基于上一版 `fb-group-monitor-skill-v3.6.6-background-progress-close-patch.zip` 继续修改，只包含需要覆盖的文件。

## 本次改动

1. 新增“完成后关机”显式开关
   - 默认不自动关机。
   - 只有用户明确要求“完成后关机 / 跑完关机 / 生成报表后关机”时，才传入 `-ShutdownAfterComplete` 或 `--shutdown-after-complete true`。
   - 默认关机延迟为 60 秒，可通过 `-ShutdownDelaySeconds 60` 或 `--shutdown-delay-seconds 60` 调整。

2. 触发顺序
   - 第二轮完整 Excel 报表、summary、collision、audit、debug rows 全部写入成功。
   - 默认通过 CDP 关闭 Chrome。
   - 写入 `codex_task_complete.json`。
   - 若显式启用关机，则执行 `shutdown.exe /s /t <秒数>`。

3. 状态记录
   - 新增/刷新 `codex_task_complete.json`，记录：完整报表是否生成、Chrome 是否关闭、是否请求关机、关机命令结果。
   - `show_background_task_status.ps1` 会读取并展示该完成状态。

4. 后台脚本支持
   - `start_background_task.ps1 -Task phase2` 支持 `-ShutdownAfterComplete` 和 `-ShutdownDelaySeconds`。
   - `monitor:bg` 对应的一键流程也支持传递相同参数。

## 使用示例

普通运行，不关机：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

明确要求完成后关机时：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownAfterComplete -ShutdownDelaySeconds 60
```

取消 Windows 关机倒计时：

```powershell
shutdown.exe /a
```

## 覆盖文件清单

```text
SKILL.md
README.md
PATCH_NOTES.md
package.json
package-lock.json
assets/task_config.template.json
scripts/phase2_collect_details.js
scripts/run_multi_games_v2.ps1
scripts/start_background_task.ps1
scripts/show_background_task_status.ps1
```
