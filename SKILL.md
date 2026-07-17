---
name: fb-group-monitor-v6.2.2
description: 用于 Facebook 游戏群组两阶段监测的严格技能。V6.2.2 默认完成后不关机；Codex 必须把用户在文本框中表达的关机意图解析为本次运行专属 shutdown_policy.json，不得要求用户手动修改配置文件或固定日期。
---

# Facebook Group Monitor V6.2.2

## V6.2.2 Codex 文本指令驱动的关机策略

- **默认完成后不关机。** 用户没有明确提到关机时，Codex 必须使用 `ShutdownMode=none`，不得沿用旧任务配置、历史对话或上一次运行的关机设置。
- 用户只需要在 Codex 文本框中说明意图；不得要求用户打开或修改 `task_config.json`、脚本或日期字段。
- Codex 在启动第二轮前必须把自然语言解析为以下三种模式之一：
  - `none`：完成后不关机；
  - `after_complete`：严格完成校验通过后关机；
  - `before_deadline`：严格完成校验通过，且完成时间早于用户指定的截止时间时关机。
- 每次启动自动在对应 `RunDir` 写入 `shutdown_policy.json`。该文件是任务计划程序、重启续跑和关机 watcher 的本次运行唯一策略来源；用户不需要手动编辑。
- 用户指定截止时间时，Codex 必须结合当前日期和用户所说时区解析为带时区的 ISO 8601 绝对时间。例如“北京时间明天上午九点前”应解析为对应日期的 `T09:00:00+08:00`。不得把示例日期、旧日期或固定日期写死。
- 用户说“立即关机”时使用 `-ShutdownDelaySeconds 0`；未指定“立即”时默认延迟 60 秒。
- 用户明确说“不关机”“保持开机”时，即使旧 `task_config.json` 含关机字段，也必须使用 `-ShutdownMode none` 覆盖。
- 兼容旧参数 `-ShutdownAfterComplete` 和 `-ShutdownBefore`，但 Codex 新任务应优先使用 V6.2.2 参数。

Codex 根据用户文本自动执行，用户无需输入 PowerShell：

```powershell
# 用户未提关机，或明确要求不关机
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode none -ShutdownInstruction "用户未要求关机"

# 用户要求完成后关机
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode after_complete -ShutdownDelaySeconds 0 -ShutdownInstruction "结束后立即关机"

# 用户要求在截止时间前完成才关机
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode before_deadline -ShutdownDeadline "<Codex 根据本次提示解析出的带时区绝对时间>" -ShutdownDelaySeconds 0 -ShutdownInstruction "<用户本次关机要求摘要>"
```

启动后必须检查 `shutdown_policy.json`，确认 `mode`、`deadline` 和 `delay_seconds` 与用户原话一致，再向用户报告任务已开始。





## V6.2.0 任务计划程序启动健康检查

- `phase2:bg` 返回成功前，必须确认 `scheduled_phase2_runner_status.json` 已建立，并且 runner PID 存活；不得仅依据任务计划程序显示 `Running` 或存在 `wscript.exe` 判断启动成功。
- WScript 启动器只接收一个自动生成的 bootstrap 脚本路径，禁止再直接转发 Manifest、TaskName 等多层参数。
- WScript 优先通过 WMI `Win32_Process.Create` 和 `ShowWindow=0` 启动隐藏 PowerShell，并写入 launcher trace。
- 默认 45 秒未进入 runner 时，必须删除卡住的任务及其孤立启动子进程，然后使用任务计划程序直接隐藏 PowerShell重试。
- 两种任务计划程序动作均失败时，必须删除失败任务并使用无窗口直接进程兜底；不得留下看似运行但没有 runner 的任务。
- 正常结束后必须删除任务定义、manifest 与生成的 bootstrap。启动失败的任务也必须立即删除，避免任务计划程序积累冗余条目。
- 状态汇报必须包含 `effective_launcher`、`startup_verified`、bootstrap 状态、launcher trace 和启动诊断。

## V6.1.0 任务计划程序、完整断点与电源规则

- `npm run phase2:bg` 默认不再依赖普通 `Start-Process` 长驻进程，而是在 Windows【任务计划程序】中创建一个确定性任务。
- 任务包含立即执行与 `AtLogOn` 触发器。系统重启导致进程中断时，任务定义不会被删除；用户重新登录 Windows 后自动启动持久化 Chrome，并从同一 `RunDir` 的完整 checkpoint 续跑。
- 每处理一个候选，都必须原子写入完整 `phase2_autosave_state.json`，其中同时包含 `staged_rows`、`manual_review_rows`、stats 和游标。不得只更新轻量进度游标；候选尚未完整处理时不得提前推进持久化游标。
- 恢复位置只能来自完整 checkpoint。`phase2_progress.json` 只负责状态观察，禁止将恢复位置推进到完整 checkpoint 之后。
- 第二轮运行期间必须启动 `runtime_power_guard.ps1`：调用 `SetThreadExecutionState` 防止睡眠，并周期性执行 `shutdown.exe /a` 取消可撤销的待执行关机/重启。除非用户明确使用 `-NoPowerGuard`，不得关闭该保护。
- 用户态电源保护不能覆盖断电、固件、管理员强制操作、内核故障或不可撤销的 Windows 更新重启，因此必须同时依赖完整 checkpoint 和登录后自动续跑。
- 同一 `RunDir` 的任务名固定；已有实例正在运行时，不得覆盖 manifest，不得创建并行重复实例。
- 每次任务计划程序执行正常结束后，无论成功或脚本错误，都应立即注销自身任务；直接注销失败时启动延迟清理进程。删除成功后同步删除 `scheduled_phase2_manifest.json`。
- 若系统重启直接中断任务，`finally` 不会执行，任务应保留用于下次登录续跑；续跑正常结束后再自删除。
- 完成后关机只允许在以下条件全部通过后执行：最终 XLSX、summary、collision、audit、debug rows 存在；autosave 与 progress 均 `finalized=true`；completion 中 `phase2_finalization_verified=true`；Chrome 已关闭；watcher token 一致。
- 独立关机 watcher 无法启动或任一校验失败时，必须保持开机；禁止直接关机回退。

启动命令：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

仅用于故障排查的旧式直接后台模式：

```powershell
npm run phase2:direct-bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

## V5.8.0 GeoNames 防御性解析与自动续跑

- GeoNames 的 `alternateNames` 可为字符串、数组或对象数组；所有名称字段先安全展开和字符串化，禁止再触发 `clean(...).replace is not a function`。
- `clean()` 对字符串、数字、布尔值、数组和常见名称对象均安全；未知对象返回空字符串，而不是终止整轮任务。
- 第二轮在同一 `RunDir` 检测到未 finalized 且 index 相同的 `phase2_autosave_state.json` 时，默认自动续跑，不再要求额外传 `--resume true`。
- V5.8.0 曾允许合并更靠后的 `phase2_progress.json` 游标；V6.0 已废止该行为，当前恢复只能采用完整 autosave 内的游标。
- `phase2_progress.json` 现在同步保存 `stats`，减少异常恢复后的审计计数缺口。
- 需要刻意从第 1 条重跑时，后台命令加 `-FreshStart`，或 Node 命令加 `--fresh-start true`。
- `audit_stats.json` 新增 `phase2_resume_enabled` 与 `phase2_resume_source`。


## V5.7.0 第二轮群名预筛

- 第一轮候选已有完整 `group_name` 时，第二轮先在本地匹配目标游戏正式名称、aliases、受控变体、兄弟标题和 IP root。
- 明确 `no_match` 的候选直接记为 `prefilter_dropped_not_relevant`，不再打开 `/about` 或讨论/发帖页面。
- 正式标题、紧凑标题、受控 `connector_x` 命中继续进入完整第二轮。
- IP root、兄弟标题等人工复核型弱命中默认继续进入 About，并仍须通过成员规模与活跃度门槛。
- seed URL、缺失群名或以省略号结尾的截断群名视为 `inconclusive`，不得仅凭预筛丢弃。
- 默认启用；可在任务配置中设置 `phase2_name_prefilter.enabled=false` 临时关闭。
- `audit_stats.json` 新增预筛通过、跳过、无法判断和节省 About 访问次数。

## V5.6.0 GeoNames 多语种安全过滤与地名抽取

- 对英语、泰语、越南语、印尼语/马来语、西语、葡语、法语、中文和阿语增加交易、社区、邀请、活动等硬停用词。
- `Bay / Santa / Victoria / Georgia / Phoenix / Orange / Classic / Beta / Mania / League / Latham` 等只可在有行政区或国家上下文的完整短语中使用，不得单独查询。
- 游戏名、别名或 IP 词根若融合在一个 token 中，整 token 丢弃；禁止从 `PokeMonedas`、`Pok'emon` 等产生 `edas / Pok` 残词。
- 多词地名保留完整短语；`San Diego / El Paso / San Antonio / Fort Worth` 不再降级为 `Diego / Paso / Antonio / Worth`。
- 群名单 token GeoNames 结果必须是精确名称，且为国家/ADM1/首府等高层级实体，或人口不少于 50,000。
- `ID / MY / DE / TR / TM / IT / IN / NO / TO / ME / LA / AT / IS / BE` 等高风险短代码不再孤立判区。
- 新增 `Hàn Quốc -> KR`、`LATHAM -> LATAM`、`GDL -> LATAM`、`SEQ + Brisbane -> Oceania`、`Arab(s) -> Middle East` 等本地规则。
- GeoNames 缓存 key 使用 `geonames-v5.6`。

## V5.5.0 地区判定与 GeoNames 上下文约束

- 群名中的明确国家、地区、大区或本地高确定性城市仍是最高优先级。
- 群名无明确地区时，固定顺序为：About Location 本地规则 → About Location GeoNames → 高确定性语言映射 → 群名 GeoNames。
- `Thai -> TH`、`Indonesian -> ID` 等语言映射不得被普通群名词的 GeoNames 结果覆盖。
- 群名 GeoNames 只接受 query 与 GeoNames 主名称/alternate name 的精确匹配；前缀或包含式匹配记为 `rejected_context_mismatch`。
- 泰语交易词、印尼/马来交易词、社群品牌词和游戏系列词必须在 query 生成前去除。
- 孤立非拉丁文字 token 不允许作为群名 GeoNames 候选；About Location 仍可正常检索。
- 缓存 key 使用 `geonames-v5.5`；旧缓存不得复用。
- 统计字段 `external_geocoder_rejected_context` 用于记录上下文拒绝数量。

## V5.4.0 人工复核表与 detail 对齐

- `manual_review` 的前 31 列与 `detail` 完全相同，字段名称、顺序、列宽和文本/百分比格式一致。
- K/L 列同样写入活跃指数与规模增速公式，并使用 `0.00%`。
- 人工复核专属信息从 AF 列开始依次追加：`language_signal`、`about_location`、`match_type`、`matched_phrase`、`negative_hit`、`review_reason`、`source_query`、`query_variant_type`、`source_is_seed_url`、`variant_threshold_applied`。
- 因此前 31 列可以直接从 `manual_review` 批量复制并粘贴到 `detail`，不会发生字段错位。
- 正常最终导出和中断恢复导出均使用同一列结构；恢复旧版 checkpoint 时会自动补齐缺失列。

## V5.3.0 游戏名称屏蔽与 XLSX 格式

- GeoNames 查询候选必须先移除当前游戏正式名称、aliases、受控标题变体和高确定性 IP 根词；不得将 `cookie / run / kingdom` 等游戏标题组成词发送给 GeoNames。
- 语言识别前，对群名、About 用户文本及前五条讨论帖子执行同一套游戏名称屏蔽；游戏标题不计入 English 或其他语言证据。
- 例如 `Cookie Run Kingdom ESPAÑOL` 在移除游戏标题后保留 `ESPAÑOL`，应识别为 `Spanish`。
- K/L 列必须为公式单元格，数字格式固定为 `0.00%`；该规则同时覆盖暂存、正常最终和恢复最终工作簿。
- GeoNames 缓存键前缀为 `geonames-v5.3`。

## V5.2.2 地区冲突裁决

- 孤立大写 `ID` 视为账号/用户 ID，不得直接映射为印度尼西亚。
- 旧任务配置中的 `region_keywords.ID: ["id", ...]` 会在运行时自动清理。
- 群名命中两个或更多不同地区时，必须读取 About 所在地，并优先使用与群名证据相容的明确国家、城市、省州或 GeoNames 结果。
- About 无法裁决时，同一业务大区多命中才回退至 `SEA / EA / EUR`；跨业务大区冲突保持空地区。
- 新来源值包括 `about_location_adjudicated_group_name_conflict` 和 `external_geocoder_about_location_adjudicated_group_name_conflict`。

## V5.2.1 人工复核数据门槛

- `manual_review` 仅用于“相关性证据需要人工判断、但运营数据已经达标”的候选。
- 候选必须先满足 `group_size >= 100`，并满足 `today_posts >= threshold` 或 `week_new_fans >= threshold`，才可进入人工复核。
- 未达到规模或活跃门槛的弱相关候选直接丢弃，不再占用人工复核队列。
- 人工复核表新增 `group_size`、`today_posts`、`week_new_fans`，便于人工确认业务价值。
- `audit_stats.json` 新增 `manual_review_candidates`、`manual_review_dropped_threshold`、`manual_review_dropped_group_size`、`manual_review_dropped_activity`。

## V5.2.0 地区判断与 GeoNames 安全规则

- 两到三位国家/地区代码必须在原始群名中以明确大写形式出现，并满足拉丁文字边界；小写介词、普通英文单词片段和 Unicode 兼容符号不得触发国家代码。
- `™ / ® / © / ℠` 必须在 NFKC 归一化前移除，防止符号被转换为国家代码字母。
- 群名中的高确定性城市、省州和地方别名应在 GeoNames 前判断；当前内置包括 `Québec`、`台中`、`台南/臺南`、`Trójmiasto`、`SoCal`，并支持 `Danmark -> EUR`。
- GeoNames 查询必须先去除游戏名、翻译括号、交易/社群/邀请/等级/礼物等泛词；禁止将任意单个剩余词无条件作为地名。
- 多词地点应优先保持连续短语，例如 `San Diego`、`El Paso TX`、`San Antonio`、`Fort Worth`、`Las Vegas`。
- 不安全候选应记为 `unsafe_query` 并计入 `external_geocoder_filtered_queries`，不得写入缓存或 `region`。
- GeoNames 缓存键使用 `geonames-v5.2` 版本前缀；旧版缓存不得影响新规则。

## V5.1.0 GeoNames 启用规则与高确定性本地识别

- 若任务配置显式提供 `external_geocoder.enabled`，必须尊重该值。
- 若任务配置未提供启用开关，但本地私有配置或 `GEONAMES_USERNAME` 存在有效用户名，必须自动启用 GeoNames。
- 本地私有配置默认路径为 `config/local/geonames.local.json`，该路径不得提交 GitHub。
- 明确别名与国旗应在 GeoNames 前识别：`大马/大馬 -> MY`、`Belgique -> EUR`、`CZ/SK -> EUR`，以及可映射的 ISO 国旗 emoji。
- 两到三位国家/地区代码允许在紧贴非拉丁文字时识别，例如 `HK朋友交換群組`；不得在普通英文单词内部误命中。
- GeoNames 仍是兜底层，不得覆盖已由明确国家、地区、大区、别名或国旗得到的结果。

## V5.0.1 地区判断新增要求：GeoNames

第二轮在原有地区判断链路失败时，可以调用 GeoNames 作为外部地理验证兜底。不得把整条群名无条件视为地点；应先去除游戏标题、交易/群组/服务器等泛词，再抽取疑似城市、省或州名。

当前优先级固定为：群名明确国家/地区/大区/本地城市 > About Location 本地规则 > About Location GeoNames > 高确定性语言映射 > 群名模糊 GeoNames。已经由更高优先级证据得到的地区不得被群名 GeoNames 覆盖。

GeoNames 凭据必须从 `config/local/geonames.local.json` 或 `GEONAMES_USERNAME` 环境变量读取；不要把用户名写入公开任务配置或文档模板。`config/local/*.json` 已由 `.gitignore` 忽略。

## 必须先读

- `SKILL.md`
- `references/judgement_rules.md`
- `references/quality_checklist.md`
- `references/xlsx_schema.md`
- `assets/task_config.template.json`


## Codex 后台运行规则

登录态验证、第一轮抓取和第二轮抓取都必须优先用后台启动脚本运行，避免 Codex 前台命令长期占用聊天输入框：

```powershell
# 打开 Chrome 登录窗口
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task login

# 后台验证登录态
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task validate-login -RunDir ".\runs\demo"

# 后台第一轮
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task phase1 -Games "GAME A,GAME B" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"

# 后台第二轮；默认 30 分钟刷新/输出一次 codex_progress_report，最终报告生成后自动关闭 Chrome
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task phase2 -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"

# Codex 必须依据当前用户文本显式传入 -ShutdownMode；默认 none。
powershell -ExecutionPolicy Bypass -File .\scripts\start_background_task.ps1 -Task phase2 -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode none -ShutdownInstruction "用户未要求关机"
```

后台启动命令返回 `background_task.json`、任务计划程序名称、stdout/stderr 日志路径和 run 目录后，Codex 必须立即回复用户“已在后台开始”，不得继续等待抓取结束。用户可继续输入文本。

查看后台状态：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show_background_task_status.ps1 -RunDir ".\runs\demo"
```

## Codex 长任务进度汇报

本 Skill 在第一轮和第二轮脚本中内置 Codex 进度汇报器：

- 第二轮默认每 30 分钟向 stdout 日志输出一行 JSON，字段 `event` 为 `codex_progress_report`，其中 `message` 是可直接转述给用户的中文进度摘要。
- 同步刷新 `codex_progress_report.json`，默认位于当前 run 目录。
- 第二轮汇报当前游戏、当前候选序号、累计处理候选数、已暂存有效行、最近候选状态和输出文件位置。
- 第一轮仍保留相同进度能力，用于需要时观察当前游戏、搜索变体、滚动轮次和候选数。
- 可通过命令行 `--progress-report-every-minutes 30`、配置项 `progress_report_every_minutes` 或环境变量 `CODEX_PROGRESS_REPORT_EVERY_MINUTES` 调整间隔；设为 `0` 可关闭定时汇报。

## 完成后关机规则

- 默认禁止自动关机；`assets/task_config.template.json` 中 `shutdown_mode` 必须为 `none`，`shutdown_after_complete` 必须为 `false`。
- Codex 必须把当前用户文本解析为 `none / after_complete / before_deadline`，由启动脚本自动写入本次运行的 `shutdown_policy.json`；不得要求用户手工改文件。
- 触发顺序必须是：第二轮完整报表写入成功 -> 确认 Chrome 已关闭 -> 写入 `codex_task_complete.json` -> 启动隐藏 PowerShell 关机 watcher；监控器等待第二轮 Node 进程退出后，再核验最终 Excel 与完成状态。
- 核验通过后，监控器执行 `shutdown.exe /s /f /t 60 /d p:0:0 /c "..."`。`/f` 会强制关闭阻塞关机的应用；监控器与采集进程分离，不依赖解锁后的交互桌面，因此锁屏时仍可执行。
- 默认延迟 60 秒关机；如需取消，让用户在关机倒计时内执行 `shutdown.exe /a`。
- `conditional_shutdown_watcher_status.json` 会记录监控器 PID、最终校验结果及强制关机命令是否已发出。
- 若独立监控器无法启动或严格完成校验失败，必须保持开机；V6.0 禁止直接关机回退。
- 若用户同时要求保留 Chrome，例如 `--no-close-chrome true`，则不得关机。

## 登录阶段

1. 先运行 `scripts/open_chrome_9222.ps1` 或后台 `start_background_task.ps1 -Task login`。
2. 提示用户手动登录 Facebook。
3. 用户回复“已登录”后，先运行 `validate_login_state.js` 或后台 `start_background_task.ps1 -Task validate-login` 验证登录态。
4. 验证结果为 `logged_in` 之前，不得搜索、采集、分析或生成报告。

## 第一轮

第一轮支持一次任务同时检索多个游戏。每个游戏独立生成搜索计划：

- 自动搜索原始标题。
- 自动搜索低风险标题变体：标点归一、冒号/破折号归一、少空格/去空格紧凑标题。
- 不自动扩展过宽关键词，例如 `Anime`、`Ragnarok`、`Tower Defense`、`All Star`。
- `connector_x` 默认关闭，只能通过 `title_variant_overrides` 配置开启。
- `seed_group_urls` 只强制进入第二轮检查，不代表自动进入最终 detail。

第一轮候选需保留：

```text
source_query, query_variant_type, source_game_name, source_is_seed_url, source_queries, query_variant_types
```

达到深翻停止条件后，必须先问用户：

```text
可以停止，继续 / 继续深翻
```

## 第二轮

只有用户确认继续后，才运行 `scripts/phase2_collect_details.js`。

第二轮规则：

- 成员数 `< 100` 的候选不进入详情采集。
- `/about` 抓取失败的记录不进入最终输出。
- `group_name` 按词序完整命中目标标题，作为 `exact_phrase_in_group_name` 强正样本。
- `group_name` 命中去空格/少空格标题，作为 `compact_title_in_group_name` 正样本。
- `group_name` 命中配置 allowlist 中的 X 连接变体，作为 `connector_x_title_in_group_name` 弱正样本，必须通过更高活跃门槛。
- 多游戏批量检索时，自动把同批次其他游戏作为兄弟标题排斥，避免互相串群。
- 仅 IP 大词根命中、仅 full_text 命中、`exact_phrase_in_full_text` 等记录只有在成员规模与活跃度门槛均达标后才进入人工复核 sheet。
- 同一个 `group_url` 只能归属一个游戏；最高分并列冲突写入 `collision_report.json`。

活跃阈值：

- 普通命中满足 `today_posts >= threshold` 或 `week_new_fans >= threshold`。
- `connector_x_title_in_group_name` 默认需满足 `group_size >= 1000`，且 `today_posts >= max(threshold, 20)` 或 `week_new_fans >= max(threshold, 50)`。

## 配置示例

```json
{
  "title_variant_overrides": {
    "All Star Tower Defense": {
      "search_variants": [
        {
          "query": "All Star X Tower Defense",
          "type": "connector_x",
          "min_group_size": 1000,
          "min_today_posts": 20,
          "min_week_new_fans": 50
        }
      ],
      "seed_group_urls": [
        "https://www.facebook.com/groups/1992312010946763",
        "https://www.facebook.com/groups/allstarshinobi"
      ]
    }
  }
}
```

## 语言判断

语言判断优先级：

1. 讨论区前五条可见玩家发言。
2. 群组名称。
3. 用户手写的“关于这个小组”非 UI 文本，仅作为最低优先级兜底。

禁止把以下内容当作语言证据：

- Facebook 账号界面语言。
- 按钮、导航、固定提示文案。
- 空 about 区块的结构标签。
- 中文界面里的“成员、帖子、简介、讨论”等 UI 文案。
- 任何西里尔字母文本都不能直接视为俄语：检测到 `Ө/ө`、`Ү/ү` 或高确定性蒙古语词组时，应优先标记 `Mongolian`；仅无蒙古语证据的通用西里尔文本才可标记 `Russian`。群名中英文 `Mongolia` / `Mongolian` 只用于地区，不单独决定语言。

## 地区判断

V5.0.1 的 `region` 采用“具体国家/地区/属地识别 -> 业务区域归并输出 -> 同大区多命中折叠”的三层规则。

单一国家/地区命中时：

- 东亚与东南亚按自身国家/地区输出，例如 `JP`、`KR`、`TW`、`TH`、`VN`、`ID`、`MY`、`SG`、`PH`。
- `Middle East`、`Central Asia`、`South Asia`、`North America`、`LATAM`、`Africa`、`EUR`、`Oceania` 按业务大区归并。
- `BR` 单列；`TR`、`NL`、`DE`、`FR`、`IT`、`PL`、`RU` 单列。

多个国家/地区同时命中时：

- 如果所有命中项属于同一个业务大区，则输出对应大区。例如 `MY + SG`、`TH + VN`、`ID + PH` 输出 `SEA`；`HK + TW` 输出 `EA`；`DE + FR` 输出 `EUR`。
- 如果命中项跨业务大区，则视为 `keyword_conflict` 并留空。例如 `UAE + PH`、`US + BR`、`JP + TH` 不强行归并。
- 同大区折叠时，`__region_source` 输出 `country_keyword_same_business_region` 或 `region_keyword_same_business_region`，`__region_keyword_hits` 保留原始命中详情。

未命中群名明确地区语义时，先读取群组 About 页中明确标注的“所在地 / Location”字段：先用本地国家/地区/城市规则，再调用 About Location GeoNames。About 的明确地点高于语言与群名模糊 GeoNames。

About 仍无法确定时，仅允许高确定性语言辅助映射：Thai -> `TH`、Vietnamese -> `VN`、Indonesian -> `ID`、Malay -> `MY`、Filipino -> `PH`、Lao -> `LA`、Khmer -> `KH`、Burmese -> `MM`、Arabic/Persian -> `Middle East`。语言已经得到地区时不得再调用群名 GeoNames。

只有群名明确规则、About 和高确定性语言均无结果时，才对经过游戏实体屏蔽和多语言泛词过滤的群名候选调用 GeoNames；群名 GeoNames 结果必须与主名称或 alternate name 精确一致。`__region_location` 保留原始所在地文本以供审计。

English、Spanish、Chinese、French、Portuguese、Mixed 等语言只作为语言展示，不得单独强制映射国家地区。Arabic / Persian 只在国家未知时辅助归入 `Middle East`；若明确识别到非洲国家，则优先输出 `Africa`，Egypt 例外归入 `Middle East`。

## 输出

本版本沿用“不保存 CSV”的输出规则。第二轮输出如下，完整 Excel 报告生成后默认自动关闭 Chrome：

- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `collision_report.json`
- `audit_stats.json`
- `debug_rows.json`

如需保留 Chrome 不关闭，可在第二轮命令中加 `--no-close-chrome true`，或在配置中设置 `close_chrome_after_report: false`。

第二轮自动保存/中断保护输出：

- `codex_progress_report.json`: Codex 进度汇报快照；第二轮默认每 30 分钟刷新并向 stdout 日志输出一次 `codex_progress_report` 事件。
- `phase2_progress.json`: 轻量进度文件，每处理 1 个候选刷新一次；仅用于观察，不得作为恢复游标的数据源。
- `phase2_autosave_state.json`: 完整恢复状态；V6.0 在每处理 1 个候选后原子刷新，包含 `staged_rows`、人工复核行、统计和同一游标。
- `phase2_autosave_summary.json`: 当前局部进度摘要，保持兼容旧观察命令。
- `partial_verified_rows.xlsx`: 已通过筛选行的可读 Excel 暂存文件；启动时先创建表头，每命中 1 条有效群组立即保存。
- `phase2_autosave_last_error.txt`: 仅当暂存 Excel 被打开或写入失败时生成；JSON 自动保存仍会继续。
- `codex_task_complete.json`: 第二轮最终状态文件，记录完整报表是否生成、Chrome 是否关闭、是否请求关机及隐藏 PowerShell 关机 watcher信息。
- `conditional_shutdown_watcher_status.json`: 仅启用完成后关机时生成；记录第二轮 Node 进程退出后的 Excel/完成状态校验和强制关机结果。

若第二轮中断，可在同一个 run 目录执行：

```powershell
node .\scripts\finalize_partial_xlsx.js --dir ".\runs\你的run目录" --snapshot-date "2026-05-12"
```

恢复脚本会优先读取 `phase2_autosave_state.json`，保留冲突归属去重逻辑，然后生成可用的 `fb_monitoring_filtered.xlsx`、summary、collision 和 audit 文件。`phase2_progress.json` 只负责观察进度，不作为最终 Excel 的数据源。

Excel 工作簿包含：

- `detail`: 严格通过样本。
- `manual_review`: 人工复核队列。

`detail` 固定列顺序保持兼容：

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits
```

审计字段进入 `manual_review`、`collision_report.json` 和 `debug_rows.json`，包括：

```text
__match_type,__matched_phrase,__source_query,__query_variant_type,__source_is_seed_url,__variant_threshold_applied
```

## 严禁

- 不得读取已导出的 CSV 再重写结果。
- 不得保存独立 CSV 明细或人工复核队列文件。
- 不得把 `manual_review` 混入最终 `detail`。
- 不得把某个游戏的 `connector_x` 特例扩散为所有游戏的通用规则。
- 不得删除原始标题自带的 `X`，例如 `Anime Rangers X`、`Ragnarok X: Next Generation`。
- 不得编造任何采集不到的数据。


## V6.1.0：任务计划程序全链路无窗口启动

- 任务计划程序不再直接执行 `powershell.exe`，改由 Windows GUI 子系统的 `wscript.exe` 调用 `scripts/hidden_powershell_launcher.vbs`。
- WScript 以窗口样式 `0` 启动并等待 scheduled runner，因此任务状态仍会保持为“正在运行”，但不会生成可见的空白 PowerShell 控制台。
- `runtime_power_guard.ps1` 与延迟任务清理进程使用 `ProcessStartInfo.CreateNoWindow=true` 启动，避免子 PowerShell 短暂闪窗。
- Chrome 启动脚本在已隐藏的 scheduled runner 内直接执行，不再额外创建 `powershell.exe` 子控制台。
- `phase2:direct-bg` 保持原有隐藏 `Start-Process` 路径；本次故障对应的任务计划程序路径已改为 WScript 全无窗口启动。
- 正常结束后的计划任务自删除、重启后登录续跑、完整 checkpoint 和严格关机门槛保持不变。

旧 V6.0.0 任务若已经在运行，覆盖文件不会改变该任务已注册的 Action。应先让旧任务结束，或停止并删除旧任务，再使用 V6.1.0 重新启动第二轮。新注册任务的 Action 应显示为 `wscript.exe`，而不是 `powershell.exe`。


## V6.2.1 兼容规则

- 旧参数 `-ShutdownBefore` 仍可识别，但 V6.2.2 新任务必须使用 `-ShutdownMode before_deadline -ShutdownDeadline <带时区 ISO 8601>`。
- 禁止在运行目录临时编写 Node 条件关机脚本；所有模式统一写入 `shutdown_policy.json`。
- 关机由隐藏 PowerShell watcher 执行；直接调用失败后依次使用 `Start-Process` 和执行后自动删除的一次性计划任务。
- 群名去除游戏标题后若仍有明确非拉丁脚本或 `Việt Nam`、`Indonesia` 等语言/国家信号，必须优先于讨论帖语言样本。
- GeoNames 瞬时网络错误默认重试，永久账号/配置错误不得重试。


## V6.2.2 强制规则

- 默认 `shutdown_mode=none`。没有当前用户明确授权，不得关机。
- 当前用户文本优先于历史配置和上次运行；每次启动都必须生成新的 `RunDir/shutdown_policy.json`。
- Codex 必须传入用户原话摘要 `-ShutdownInstruction`，便于审计；不得把任意示例日期当作真实截止时间。
- `before_deadline` 必须提供带时区绝对时间；无法可靠确定日期或时区时，必须先向用户确认，不能猜测。
- 任务计划程序和 direct fallback 都必须读取同一 `shutdown_policy.json`；系统重启后继续使用该策略。
- 关机任务执行后仍须自删除，不得留下冗余计划任务。
