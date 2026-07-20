# FB Game Group Monitor Skill V6.3.0


## V6.3.0：关机改由当前 runner 直接协调

本次实机记录显示，V6.2.2 的独立 PowerShell watcher 虽返回 PID `27420`，但没有生成首个状态文件，也没有 PowerShell 引擎启动记录。Node 仅凭 PID 即把关机标记为已启动，且丢弃了 watcher 标准错误，最终 `shutdown.exe` 从未被调用。

V6.3.0 不再为任务计划程序路径启动独立关机 watcher。第二轮完成后，Node 只写入带随机 token 的“关机待 runner 执行”状态；当前已存活并已完成采集的隐藏 PowerShell runner 在停止电源保护、删除主计划任务后，同步执行 `verified_shutdown_coordinator.ps1`。该协调器重新读取本次 `shutdown_policy.json`，重新核验最终文件、finalized checkpoint/progress、Chrome 关闭状态和 request token，然后直接调用 `System32\shutdown.exe`。

新增完整诊断：

- `shutdown_coordinator_status.json`
- `shutdown_coordinator.stdout.log`
- `shutdown_coordinator.stderr.log`
- `codex_task_complete.json` 中的 `shutdown_coordinator`、`shutdown_request_token` 和实际 `shutdown_result`

默认仍为完成后不关机；Codex 继续根据用户当前文本生成本次运行的 `shutdown_policy.json`。

## V6.2.2：在 Codex 文本框中指定是否关机

默认完成后**不关机**。用户只需在对 Codex 的任务描述中写明：

- “完成后不关机”或不提关机；
- “完成后立即关机”；
- “如果北京时间某日某时前完成，就立即关机”。

Codex 会自动把该文本解析成运行参数，并在本次 `RunDir` 生成 `shutdown_policy.json`。用户不需要打开或修改任何 JSON、PowerShell 或日期配置。该运行文件会被任务计划程序、系统重启续跑和最终 runner 关机协调器共同读取。

| 用户意图 | policy mode | 行为 |
|---|---|---|
| 未提关机／明确不关机 | `none` | 生成报表、关闭 Chrome、保持开机 |
| 完成后关机 | `after_complete` | 严格终稿校验通过后关机 |
| 截止时间前完成才关机 | `before_deadline` | 校验通过且完成时间早于截止时间才关机 |

`shutdown_policy.json` 由 Codex/启动脚本自动生成，不应由用户手动编辑。截止时间必须根据本次提示词动态解析，文档示例日期不得复用。

# V6.2.1.0 任务计划程序启动链修复

V6.1.0 在部分 Windows 环境中会出现 `wscript.exe` 长驻，但 scheduled runner、power guard 和日志均未建立。V6.2.0 不再把“任务状态为 Running”视为启动成功，而是必须验证 `scheduled_phase2_runner_status.json` 中的 runner PID 确实存活。

启动链依次为：

1. WScript + WMI 隐藏进程，只传递一个自动生成的 bootstrap 脚本路径，避免多层参数转义；
2. 若在默认 45 秒内未进入 runner，自动停止并删除卡住任务，改用任务计划程序直接隐藏 PowerShell；
3. 若第二种方式仍失败，删除失败任务并使用 `CreateNoWindow=true` 的直接隐藏进程继续采集，保证不会静默空转。

新增诊断文件：

- `scheduled_phase2_launcher_trace.log`
- `scheduled_phase2_bootstrap_status.json`
- `scheduled_phase2_startup_diagnostic.json`

任务正常结束后仍会删除任务定义、manifest 与临时 bootstrap，不在【任务计划程序】中遗留冗余条目。系统重启中断时，仅保留真正用于登录后续跑的任务。

# V6.2.0 任务计划程序启动链修复、逐候选完整断点与运行期电源保护

V6.1.0 将第二轮后台执行默认切换为 Windows【任务计划程序】。任务以同一 `RunDir` 的确定性名称创建，立即启动，并附加 `AtLogOn` 触发器：Windows 更新或系统重启中断任务后，用户重新登录 Windows 时会自动打开持久化 Chrome 并从完整 checkpoint 续跑。

核心规则：

- 每处理一个候选，都原子写入完整 `phase2_autosave_state.json`，同时保存 `detail` 暂存行、`manual_review` 行、stats 与游标；候选处理中断时游标保持在上一条完整记录，下次重跑未完成候选；
- 恢复只读取完整 checkpoint 的游标，`phase2_progress.json` 仅用于观察，不能把恢复位置推进到尚未保存完整数据的位置；
- 第二轮运行期间启动 `runtime_power_guard.ps1`：保持系统唤醒，并周期性执行 `shutdown.exe /a`，取消可撤销的待执行关机/重启；
- 完成后关机必须通过严格门槛：最终 XLSX、summary、collision、audit、debug rows、finalized checkpoint、finalized progress、completion token 和 Chrome 关闭状态全部有效；
- 关机 watcher 启动失败时不再直接回退关机，机器保持开机；
- 任务计划程序任务在每次正常执行结束后立即自删除；如果执行被系统重启打断，则保留到下次登录自动续跑，续跑正常结束后删除；
- 同一 `RunDir` 已有正在运行的任务时，不覆盖 manifest，也不创建重复实例。

正常启动：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

查看任务与电源保护状态：

```powershell
npm run status:bg -- -RunDir ".\runs\demo"
```

需要临时绕过任务计划程序、继续使用旧式直接后台进程时：

```powershell
npm run phase2:direct-bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

> 运行期电源保护属于用户态防护。它能阻止睡眠并取消可撤销的关机/重启倒计时，但无法百分之百覆盖断电、固件、管理员强制操作、内核故障或不可撤销的 Windows 更新重启。因此 V6.0 同时依靠逐候选完整 checkpoint 与登录后自动续跑降低风险。

# V5.8.0 GeoNames 稳定性与自动恢复

本版本修复 GeoNames 返回对象型 `alternateNames` 时触发的类型错误。第二轮在相同运行目录发现可恢复 checkpoint 时会自动继续，不必再手工追加 `--resume true`。

正常继续同一目录：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

上述命令若发现未完成 checkpoint，会自动续跑。需要放弃旧断点并从第 1 条重跑：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -FreshStart
```

配置项 `phase2_auto_resume` 默认是 `true`。显式 `--fresh-start true` 或 PowerShell 的 `-FreshStart` 优先。

## V5.7.0 第二轮候选群名预筛

第二轮不再先打开所有候选的 About 页面。对于第一轮已经采集到完整群名的候选，会先做纯本地相关性预筛：

- 完整/紧凑目标标题或受控变体命中：继续采集 About 与讨论页；
- IP root、兄弟标题等弱相关样本：默认继续，以保留人工复核能力；
- 群名完整且完全无相关证据：立即跳过，不访问 About/发帖页；
- seed URL、群名缺失或明显截断：无法预判，继续进入 About。

配置：

```json
"phase2_name_prefilter": {
  "enabled": true,
  "allow_manual_review_candidates": true,
  "treat_incomplete_as_inconclusive": true
}
```

统计新增：`phase2_name_prefilter_checked`、`phase2_name_prefilter_passed_strong`、`phase2_name_prefilter_passed_manual_review`、`phase2_name_prefilter_inconclusive`、`phase2_name_prefilter_skipped_no_match`、`phase2_name_prefilter_skipped_manual_review`、`about_avoided_by_name_prefilter`。

## V5.6.0 GeoNames 多语种停用词、上下文限制与抽取修复

- 扩充英语、泰语、越南语、印尼语/马来语、西语、葡语、法语、中文、阿语的非地点停用词；`mua bán / jual beli / ซื้อขาย / بيع وشراء / comunidad / amis` 等不再进入 GeoNames。
- 对可能是真实地点、也可能是普通词或品牌名的词采用上下文限制：`Orange County / Victoria BC / Santa Rosa` 可查询，孤立 `Orange / Victoria / Santa` 不查询。
- 删除游戏实体时按完整 token 丢弃，避免 `PokeMonedas -> edas`、`Pok'emon -> Pok`。
- 地名候选不再从多词短语逐级拆成普通单词；保留 `San Diego / El Paso / San Antonio / Fort Worth`。
- 单 token 群名地名需满足 GeoNames 精确名称，并为高层级行政实体/首府，或人口不少于 `50,000`。
- 高风险 ISO 短代码不再孤立判区；`™` 不能产生 `TM`，`de` 不能产生德国，`TR` 不能命中 `Trójmiasto`。
- 本地新增 `Hàn Quốc`、`LATHAM`、`GDL`、`SEQ + Brisbane`、`Arab(s)` 等别名规则。
- 缓存 namespace 升级为 `geonames-v5.6`。覆盖后应删除旧 `*geocode*cache*.json`。

## V5.5.0 GeoNames 上下文校验与地区优先级

- 未命中群名明确国家/地区时，地区判断顺序调整为：**About 明确所在地（本地规则 / GeoNames）→ 高确定性语言映射 → 群名模糊 GeoNames**。
- 泰语、印尼语、马来语等可稳定映射地区的语言证据，不再被群名中的普通词 GeoNames 假阳性覆盖。
- 群名 GeoNames 仅接受“查询短语与 GeoNames 主名称或别名完全一致”的结果；`talk -> Town Talk`、`jual -> Kampung Telok Jual`、`วิน -> Winnipeg` 等包含式或模糊式结果会拒绝。
- 新增泰语、印尼语、马来语交易/社群词清洗，并屏蔽 `Talk&Trade`、`GREEN-TOWN`、`Jual/Beli`、`Ovenbreak & Classic` 等非地点语义。
- 孤立的非拉丁文字 token 不再作为群名地点查询；明确 About Location 不受此限制。
- GeoNames 缓存命名空间升级为 `geonames-v5.5`，不复用 V5.3/V5.4 产生的 accepted 假阳性。
- `audit_stats.json` 新增 `external_geocoder_rejected_context`，用于统计因“GeoNames 名称并非精确匹配”而拒绝的结果。
- 保留 V5.4.0 的 `manual_review` 与 `detail` 对齐格式。

## V5.4.0 人工复核表与 detail 对齐

- `manual_review` 的前 31 列与 `detail` 完全相同，字段名称、顺序、列宽和文本/百分比格式一致。
- K/L 列同样写入活跃指数与规模增速公式，并使用 `0.00%`。
- 人工复核专属信息从 AF 列开始依次追加：`language_signal`、`about_location`、`match_type`、`matched_phrase`、`negative_hit`、`review_reason`、`source_query`、`query_variant_type`、`source_is_seed_url`、`variant_threshold_applied`。
- 因此前 31 列可以直接从 `manual_review` 批量复制并粘贴到 `detail`，不会发生字段错位。
- 正常最终导出和中断恢复导出均使用同一列结构；恢复旧版 checkpoint 时会自动补齐缺失列。

## V5.3.0：游戏名隔离与 Excel 百分比格式

- GeoNames 生成查询词前，必须剔除当前游戏的正式名称、别名、受控标题变体及高确定性 IP 根词；游戏名称本身不得成为地名候选。
- 群名、About 用户文本和讨论区前五条玩家发言进入语言识别前，也必须剔除当前游戏名称及别名，避免英文游戏标题压过西班牙语、泰语等实际讨论语言。
- `partial_verified_rows.xlsx`、正常完成的 `fb_monitoring_filtered.xlsx`、以及中断恢复生成的最终 XLSX，K/L 两列均为公式单元格并固定采用 `0.00%` 百分比格式。
- GeoNames 缓存命名空间升级为 `geonames-v5.3`，不复用旧版由游戏词造成的 accepted 假阳性。

## V5.2.2：ID 误判保护与 About 冲突裁决

- 群名中的孤立大写 `ID` 不再作为印度尼西亚国家代码。印度尼西亚只能由 `Indonesia / Indo`、印尼语、印尼城市、🇮🇩、About Location 或 GeoNames 等更可靠证据判定。
- 即使旧任务配置仍在 `region_keywords.ID` 中保留 `id`，运行时也会自动剔除，避免历史配置继续误判账号 ID。
- 当群名同时命中两个或更多不同地区证据时，不再立即折叠为 `SEA / EA / EUR` 或直接留空；第二轮会先检查已经抓取的 About 所在地。
- About 本地位置或 About GeoNames 结果若与群名中的某个地区证据一致，则采用 About 的更具体结论，例如 `TH + ID` 且 About 为 Bangkok 时输出 `TH`。
- About 无法裁决时，同一业务大区的多地区命中仍可回退到宽泛大区；跨业务大区冲突继续留空。

## V5.2.1：人工复核队列先过数据门槛

V5.2.1 修正了旧版 `manual_review` 在阈值判断前写入的问题。现在弱相关候选必须先满足：

- `group_size >= 100`；
- `today_posts >= threshold` 或 `week_new_fans >= threshold`。

只有运营数据达标、但标题相关性仍需人工判断的候选，才会进入 `manual_review`。规模或活跃度不达标的候选直接丢弃。人工复核表新增 `group_size`、`today_posts`、`week_new_fans` 三列；审计统计新增人工复核候选及阈值淘汰计数。

## V5.2.0：地区识别精度修复

V5.2.0 重点修复 GeoNames 补全和第二轮地区判断中的假阳性：

- 两到三位国家/地区代码只在原始文本中以**明确大写代码**出现时生效；小写介词 `de` 不再视为德国，`Trójmiasto` 开头的 `Tr` 不再视为土耳其。
- 在 Unicode 归一化前移除 `™ / ® / © / ℠`，防止 `™` 被兼容分解为 `TM` 并误判为土库曼斯坦。
- 群组名称新增城市/省州本地匹配阶段，优先于 GeoNames：支持 `Québec`、`台中`、`台南/臺南`、`Trójmiasto`、`SoCal` 等高确定性地点；`Danmark` 直接映射为 `EUR`。
- GeoNames 候选抽取不再把整条群名或任意剩余单词当作地点。新增多语言泛词过滤、翻译括号移除、地点短语优先和单词安全检查。
- `Come`、`Compra`、`Gift`、`trades`、`Bay`、`Only`、`Daily`、`Store`、`Level` 等泛词不会再送入 GeoNames。
- 对 `San Diego`、`El Paso TX`、`San Antonio`、`Fort Worth`、`Las Vegas` 等连续地点短语优先保留完整查询。
- GeoNames 缓存键升级为 `geonames-v5.2`，旧版假阳性缓存不会被本版本复用；错误和不安全查询仍不写入缓存。
- `audit_stats.json` 新增 `external_geocoder_filtered_queries`，统计被安全过滤器拦截的候选查询数。

地区判断仍遵循保守原则：已有明确国家/地区、本地城市映射或高可信证据时不调用 GeoNames；GeoNames 低置信、歧义或泛词候选均保持 `region` 为空。

## V5.1.0：GeoNames 自动启用与高确定性地区规则

V5.1.0 解决临时任务配置遗漏 `external_geocoder` 后 GeoNames 静默关闭的问题：

- 当任务配置未显式设置 `external_geocoder.enabled`，但 `config/local/geonames.local.json` 或 `GEONAMES_USERNAME` 已提供有效用户名时，第二轮自动启用 GeoNames。
- 任务配置显式写入 `enabled: false` 时仍会禁用，便于单次任务主动关闭外部请求。
- `audit_stats.json` 新增 `external_geocoder_enable_source`，可区分 `task_config_explicit`、`local_config_explicit`、`auto_credentials` 和 `disabled_no_credentials`。
- 本地高确定性地区规则新增：`大马/大馬 -> MY`、`Belgique -> EUR`、`CZ/SK -> EUR`。
- 支持从国旗 emoji 解析 ISO 国家代码，例如 `🇫🇷 -> FR`、`🇨🇿🇸🇰 -> EUR`。
- 两到三位地区代码可在紧贴中文时命中，例如 `HK朋友交換群組 -> HK`。

GeoNames 仍只在更高优先级的明确地区规则无法确定结果时调用。

## V5.0.1 GeoNames 修复说明

V5.0.1 修复了 V5.0.0 中 GeoNames 全部返回 `network_error` 的问题。GeoNames endpoint 现在默认使用：

```text
http://api.geonames.org/searchJSON
```

如需 HTTPS，可在配置中改为：

```text
https://secure.geonames.org/searchJSON
```

不要使用 `https://api.geonames.org/searchJSON`。覆盖后建议删除旧 geocode cache：

```powershell
Get-ChildItem .\runs -Recurse -Filter "*geocode*cache*.json" | Remove-Item -Force
```

新增审计字段：`__geocoder_attempted_queries`、`__geocoder_endpoint`、`__geocoder_error_reason`。


用于 Facebook 游戏群组两阶段监测的 Codex Skill。

本项目按“先登录、再搜索、再详情采集”的流程运行，支持一次任务同时检索多个游戏。V6.2.0 支持带 runner 健康检查和自动兜底的任务计划程序后台启动流程：登录态验证、第一轮抓取和第二轮抓取都可在后台运行，启动命令会立即返回任务计划程序名称与日志路径，避免 Codex 前台命令占用聊天输入框。第二轮默认每 30 分钟刷新进度汇报，最终 Excel 报告生成后自动关闭 Chrome；系统关机默认关闭；Codex 根据当前文本生成运行专属 `shutdown_policy.json`，启用时由当前隐藏 PowerShell runner 在收尾阶段执行严格校验后的强制关机。V5.8.0 同时保留此前对蒙古语误判为俄语的修复。


## GeoNames 外部地理解析兜底

第二轮地区判断包含 GeoNames 外部验证兜底。它用于处理群组名称或 About/简介中只出现城市、省、州等细粒度地名的情况，例如 `Ulaanbaatar`、`Cebu`、`California` 这类旧版未必能通过固定词典识别的位置。

调用逻辑是兜底式的：群名明确国家/地区/大区优先；其余情况先验证 About Location，再使用允许的高确定性语言映射，最后才对经过严格清洗的群名地点候选调用 GeoNames。通过验证后，GeoNames 返回的国家代码会映射为 Skill 的 `region`。歧义、低置信度、超时和无结果都不会中断采集。

GeoNames 用户名放在 `config/local/geonames.local.json`，根目录 `.gitignore` 已默认忽略 `config/local/*.json`，该文件不建议上传 GitHub。

## 核心能力

- 第一阶段按每个游戏独立生成搜索计划。
- 自动搜索低风险变体：原始标题、标点归一、冒号/破折号归一、少空格/去空格紧凑标题。
- `connector_x` 默认关闭，只能通过 `title_variant_overrides` 配置开启。
- `seed_group_urls` 可把已知重要群组强制送入第二轮检查，但不会自动进入最终结果。
- 第二阶段进入群组详情页，采集成员规模、今日发帖、上周新增、是否上月已存在等指标。
- 多游戏批量检索时，自动把同批次其他游戏作为兄弟标题排斥。
- 弱相关、仅词根命中、全文命中等记录只有在成员规模和活跃度达标后才进入人工复核 sheet，不混入最终明细。
- 默认全球监测，不按语言或地区硬过滤；语言和地区只作为展示与分析字段。
- 语言判断以讨论区前五条可见玩家发言为主，群组名称为辅助。
- “关于这个小组”只在存在用户手写的非 UI 内容时作为最低优先级兜底。
- 地区判断优先看群组名称中的明确地区语义；群名同时出现多个不同地区证据时先读取 About 所在地裁决，只有 About 无法裁决时，同一业务大区的多国家/地区组合才回退到该大区。
- 群名没有明确地区时，优先读取 About 页中明确标注的“所在地 / Location”字段；About 本地规则或 GeoNames 均高于语言映射和群名模糊 GeoNames。
- About 仍无结果时，使用泰语、印尼语等高确定性语言映射；只有语言也无法判定时，才调用群名 GeoNames。
- Excel 输出固定列顺序，`snapshot_date` 和 `group_id` 强制文本格式，活跃指数/规模增速为百分比公式。
- 第二轮后台启动后会立即返回任务计划程序名称、日志路径和运行目录；默认每 30 分钟输出一次 `codex_progress_report`，并刷新 `codex_progress_report.json`。
- 可选“完成后关机”：默认不启用。启用后会在最终报表生成并确认 Chrome 已关闭后，由当前隐藏 PowerShell runner 调用关机协调器，重新核验结果文件后执行 `shutdown.exe /s /f /t <秒数>`。

## 变体规则

自动启用：

- `canonical`：原始标题。
- `punctuation_normalized`：标点、冒号、破折号归一。
- `compact_spacing`：少空格/去空格紧凑标题，例如 `Allstar TowerDefense`。

必须配置后才启用：

- `connector_x`：例如 `All Star X Tower Defense`。
- `seed_group_urls`：例如指定已知大群 URL。

配置示例：

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


## Codex 后台运行与进度汇报

建议在 Codex 中使用后台启动脚本，不要直接前台运行长抓取命令：

```powershell
# 打开 Chrome 登录窗口
npm run login:bg

# 用户登录后，后台验证登录态
npm run validate-login:bg -- -RunDir ".\runs\demo"

# 后台第一轮
npm run phase1:bg -- -Games "All Star Tower Defense" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"

# 后台第二轮；默认 30 分钟刷新/输出一次 codex_progress_report，完成后自动关闭 Chrome
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"

# Codex 根据当前用户文本显式传入模式；默认 none
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode none -ShutdownInstruction "用户未要求关机"
```

后台启动脚本会立即返回：

- `scheduled_task_name`：第二轮对应的任务计划程序任务名；正常执行结束后自删除。
- `run_dir`：当前输出目录。
- `stdout_log` / `stderr_log`：后台日志。
- `codex_progress_report.json`：Codex 进度快照。
- `background_task.json`：本次后台任务元信息。
- `codex_task_complete.json`：第二轮完成状态；若启用关机，会记录 runner 关机协调器、request token 和实际执行结果。
- `shutdown_coordinator_status.json`：V6.3 主关机协调状态；`conditional_shutdown_watcher_status.json` 仅保留兼容副本。

查看状态：

```powershell
npm run status:bg -- -RunDir ".\runs\demo"
```

第二轮默认每 30 分钟输出一次 `codex_progress_report` 并刷新 `codex_progress_report.json`。输出 JSON 中的 `message` 字段是中文进度摘要，可直接发给用户。

可通过命令行、配置或环境变量调整间隔：

```powershell
node .\scripts\phase2_collect_details.js --index ".\runs\demo\phase1_index.json" --progress-report-every-minutes 30
```

```json
{
  "progress_report_every_minutes": 30,
  "close_chrome_after_report": true,
  "shutdown_mode": "none",
  "shutdown_after_complete": false,
  "shutdown_before": "",
  "shutdown_delay_seconds": 60
}
```

设为 `0` 可关闭定时汇报。第二轮最终 Excel 报告生成后默认自动关闭 Chrome；如需保留浏览器，加 `--no-close-chrome true`，或在配置中设置 `"close_chrome_after_report": false`。

自动关机默认关闭。Codex 必须依据当前文本选择 `none / after_complete / before_deadline`，启动脚本自动生成本次运行的 `shutdown_policy.json`。用户无需修改配置文件。启用关机后，第二轮先写入最终报表并确认 Chrome 已关闭，再由隐藏 PowerShell watcher 核验 Excel、finalized checkpoint、completion token 和截止时间，随后执行 `shutdown.exe /s /f /t <秒数>`。若协调器执行失败或任一严格校验不通过，电脑保持开机，并保留独立 stdout/stderr/status 诊断。

## 输出文件

第二阶段最终生成；完整 Excel 报告写入成功后，默认通过 Chrome CDP 自动关闭采集浏览器：

- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `collision_report.json`
- `audit_stats.json`
- `debug_rows.json`

第二阶段运行中会即时生成/刷新：

- `codex_progress_report.json`: Codex 定时进度快照，第二轮默认每 30 分钟刷新一次，并向 stdout 日志输出 `codex_progress_report`。
- `phase2_progress.json`: 轻量进度文件，每处理 1 个候选刷新一次；仅用于观察当前跑到哪个游戏/第几个候选，不参与恢复游标。
- `phase2_autosave_state.json`: 完整恢复状态；V6.0 每处理 1 个候选即原子刷新，包含 `staged_rows`、人工复核行、统计和同一游标。
- `phase2_autosave_summary.json`: 当前局部摘要，保持兼容旧观察命令。
- `partial_verified_rows.xlsx`: 已通过筛选行的可读暂存表；启动时先创建表头，每命中 1 条有效群组就立即保存。
- `phase2_autosave_last_error.txt`: 仅当暂存 Excel 写入失败时出现；通常是文件被 Excel 打开占用。
- `codex_task_complete.json`: 第二轮最终状态文件，记录完整报表是否生成、Chrome 是否关闭、是否请求关机及隐藏 PowerShell 关机 watcher信息。
- `conditional_shutdown_watcher_status.json`: 仅启用完成后关机时生成；记录第二轮退出后的文件校验与强制关机结果。

Excel 工作簿包含：

- `detail`: 严格通过的最终明细。
- `manual_review`: 已通过成员规模与活跃度门槛、但相关性仍需人工判断的队列。

不再生成任何独立 CSV 明细或人工复核队列文件。

## Excel 明细列

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits
```

Excel 格式规则：

- `snapshot_date` 写为文本，例如 `2026-05-06`。
- `group_id` 写为文本，避免长数字变成科学计数法。
- `活跃指数=当日新帖/社群规模` 使用公式 `=IFERROR(Ix/Hx,"")`。
- `规模增速=上周新增/(社群规模-上周新增）` 使用公式 `=IFERROR(Jx/(Hx-Jx),"")`。
- 两个公式列均为百分比格式，保留 2 位小数。

## 语言与地区规则

语言判断优先级：

1. 讨论区前五条可见玩家发言。
2. 群组名称。
3. 用户手写的“关于这个小组”非 UI 文本。

不得把 Facebook 界面语言、按钮、导航、固定结构文案、空 about 区块结构文字当作语言证据。若前五条可见帖子是无正文的图片/视频帖，或正文极短且只能抓到“成员、帖子、刚刚、查看更多、最相关、评论、分享、查看翻译”等界面文案，则该帖不计入语言证据；证据不足时返回 `Unknown`，不得默认判为 `Chinese`。

蒙古语与俄语都使用西里尔字母，因此不能将任意西里尔文本直接判为俄语。出现蒙古语特有字母 `Ө/ө`、`Ү/ү` 时，优先判为 `Mongolian`；不含这两个字母的短句会再通过“`сайн байна`、`байна уу`、`баярлалаа`、`тоглоом`、`тоглогч`、`зарна`、`авна`、`солно`”等高确定性蒙古语词组识别。只有不存在上述蒙古语证据的通用西里尔文本，才回退为 `Russian`。群名中的 `Mongolia` / `Mongolian` 仍只用于地区识别，不会单独把语言判为蒙古语。

地区判断优先级：

1. 群组名称里的明确国家、地区、属地、大区或本地高确定性城市。
2. 群名出现多个不同地区证据时，先使用 About 所在地裁决；About 无法裁决后，同一业务大区才回退到 `SEA / EA / EUR`，跨业务大区保持空值。
3. 群名没有明确地区时，读取 About 页“所在地 / Location”：先本地规则，再调用 About Location GeoNames。
4. About 无结果时，使用高确定性语言辅助映射，例如 Thai -> TH、Vietnamese -> VN、Indonesian -> ID、Malay -> MY、Filipino -> PH、Arabic/Persian -> Middle East。
5. 前四步都没有结果时，才调用群名 GeoNames；查询必须已去除所有已知游戏实体和多语言交易/社群词，且返回地名必须精确匹配 query。
6. 无法确定时留空。

单一国家/地区命中时，东亚与东南亚仍按自身输出；Middle East、Central Asia、South Asia、North America、LATAM、Africa、EUR、Oceania 按业务大区归并；BR 单列；TR、NL、DE、FR、IT、PL、RU 单列。

English、Spanish、Chinese、French、Portuguese、Mixed 等语言只作为语言展示，不单独强制映射国家地区。Arabic / Persian 只在国家未知时辅助归入 `Middle East`；若明确识别到非洲国家，则优先输出 `Africa`，Egypt 例外归入 `Middle East`。

## 使用方法

安装依赖：

```powershell
npm install
```

打开 Chrome 并手动登录 Facebook：

```powershell
npm run login:bg
```

用户完成登录后验证登录态：

```powershell
npm run validate-login:bg -- -RunDir ".\runs\demo"
```

第一阶段后台运行：

```powershell
npm run phase1:bg -- -Games "All Star Tower Defense" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -Cdp "http://127.0.0.1:9222"
```

第二阶段后台运行：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -Cdp "http://127.0.0.1:9222"
```

第二阶段默认采用更轻的即时保存方式：

- 每处理 1 个候选，刷新 `phase2_progress.json`、`phase2_autosave_summary.json` 和完整 `phase2_autosave_state.json`；完整状态包含 detail 暂存、manual_review、stats 与游标。
- 只有当某个群组通过全部筛选并进入有效结果时，才刷新 `partial_verified_rows.xlsx`，避免对 XLSX 进行不必要的逐候选重写。
- 这样既保留断点进度，又避免“每个候选都重写完整 Excel”的额外开销。

如果中途断电、Ctrl+C、浏览器崩溃或脚本报错，不要删除 run 目录，直接用自动保存状态恢复当前已跑出的结果：

```powershell
node .\scripts\finalize_partial_xlsx.js --dir ".\runs\demo" --snapshot-date "2026-05-12"
```

恢复脚本优先读取 `phase2_autosave_state.json`；如果没有该文件，才回退读取 `partial_verified_rows.xlsx`。`phase2_progress.json` 主要用于观察进度，不直接作为最终 Excel 的数据源。

一键流程也可以后台运行：

```powershell
npm run monitor:bg -- -Games "Anime Guardians,Anime Last Stand,Anime Overload,Anime Rangers X,Anime Tactical Simulator,Anime Vanguards" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json"
```

## 仓库结构

- `SKILL.md`: Codex Skill 工作流说明。
- `scripts/`: 登录、第一阶段、第二阶段脚本。
- `references/`: 判定规则、Excel schema、质量检查清单。
- `assets/`: 配置模板。
- `agents/`: 可选 agent 配置。
- `package.json`: Node.js 依赖与命令。

## GitHub 上传清单

建议上传：

- `SKILL.md`
- `README.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`
- `package.json`
- `package-lock.json`
- `.gitignore`

不要上传：

- `node_modules/`
- `runs/`
- Facebook 输出结果文件
- 浏览器缓存、Cookie、登录态、截图、临时文件

## 隐私说明

本项目不应包含 Facebook 账号、Cookie、token 或任何登录态文件。所有采集都应通过用户手动登录的浏览器会话执行。


## V6.1.0：任务计划程序全链路无窗口启动

- 任务计划程序不再直接执行 `powershell.exe`，改由 Windows GUI 子系统的 `wscript.exe` 调用 `scripts/hidden_powershell_launcher.vbs`。
- WScript 以窗口样式 `0` 启动并等待 scheduled runner，因此任务状态仍会保持为“正在运行”，但不会生成可见的空白 PowerShell 控制台。
- `runtime_power_guard.ps1` 与延迟任务清理进程使用 `ProcessStartInfo.CreateNoWindow=true` 启动，避免子 PowerShell 短暂闪窗。
- Chrome 启动脚本在已隐藏的 scheduled runner 内直接执行，不再额外创建 `powershell.exe` 子控制台。
- `phase2:direct-bg` 保持原有隐藏 `Start-Process` 路径；本次故障对应的任务计划程序路径已改为 WScript 全无窗口启动。
- 正常结束后的计划任务自删除、重启后登录续跑、完整 checkpoint 和严格关机门槛保持不变。

旧 V6.0.0 任务若已经在运行，覆盖文件不会改变该任务已注册的 Action。应先让旧任务结束，或停止并删除旧任务，再使用 V6.1.0 重新启动第二轮。新注册任务的 Action 应显示为 `wscript.exe`，而不是 `powershell.exe`。


## V6.2.2 文本意图关机

Codex 应根据当前用户文本调用：

```powershell
# 默认不关机
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode none -ShutdownInstruction "用户未要求关机"

# 完成后立即关机
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode after_complete -ShutdownDelaySeconds 0 -ShutdownInstruction "完成后立即关机"

# 指定截止时间前完成才关机
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownMode before_deadline -ShutdownDeadline "<Codex 根据本次提示解析出的带时区绝对时间>" -ShutdownDelaySeconds 0 -ShutdownInstruction "<用户本次关机要求摘要>"
```

截止时间必须根据本次提示词动态解析，示例日期不得复用。`shutdown_policy.json` 会自动生成并贯穿任务计划程序、direct fallback 和重启续跑。旧 `-ShutdownBefore` 参数仅保留兼容性。

V6.2.1 的群名强语言证据优先和 GeoNames 瞬时错误重试继续保留。
