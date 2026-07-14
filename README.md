# FB Game Group Monitor Skill V5.3.0


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

本项目按“先登录、再搜索、再详情采集”的流程运行，支持一次任务同时检索多个游戏。V5.3.0 支持后台启动流程：登录态验证、第一轮抓取和第二轮抓取都可在后台运行，启动命令会立即返回 PID 与日志路径，避免 Codex 前台命令占用聊天输入框。第二轮默认每 30 分钟刷新进度汇报，最终 Excel 报告生成后自动关闭 Chrome；系统关机默认关闭，只有用户明确要求“完成后关机”时才通过显式参数触发，并由独立 Node 监控器在锁屏状态下执行强制关机。V5.3.0 同时保留此前对蒙古语误判为俄语的修复。


## GeoNames 外部地理解析兜底

第二轮地区判断包含 GeoNames 外部验证兜底。它用于处理群组名称或 About/简介中只出现城市、省、州等细粒度地名的情况，例如 `Ulaanbaatar`、`Cebu`、`California` 这类旧版未必能通过固定词典识别的位置。

调用逻辑是兜底式的：如果群名已经有明确国家/地区/大区，仍按原规则输出；只有原有链路无法确定地区时，才从群名和 About Location 中抽取疑似地名，调用 GeoNames 验证。通过验证后，GeoNames 返回的国家代码会映射为 Skill 的 `region`。歧义、低置信度、超时和无结果都不会中断采集。

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
- 当群名与允许的语言兜底仍无法确定地区时，读取 About 页中明确标注的“所在地 / Location”字段；国家/地区优先，已配置的高确定性城市次之。
- Excel 输出固定列顺序，`snapshot_date` 和 `group_id` 强制文本格式，活跃指数/规模增速为百分比公式。
- 后台启动后会立即返回 PID 与日志路径；第二轮默认每 30 分钟输出一次 `codex_progress_report`，并刷新 `codex_progress_report.json`。
- 可选“完成后关机”：默认不启用。启用后会在最终报表生成并确认 Chrome 已关闭后，启动独立 Node 监控器；该监控器等待第二轮进程退出、核验结果文件，再执行 `shutdown.exe /s /f /t <秒数>`。

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

# 只有用户明确要求“完成后关机”时，才加入这个开关；默认不要加
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownAfterComplete -ShutdownDelaySeconds 60
```

后台启动脚本会立即返回：

- `pid`：后台进程 ID。
- `run_dir`：当前输出目录。
- `stdout_log` / `stderr_log`：后台日志。
- `codex_progress_report.json`：Codex 进度快照。
- `background_task.json`：本次后台任务元信息。
- `codex_task_complete.json`：第二轮完成状态；若启用关机，会记录独立关机监控器信息。
- `conditional_shutdown_watcher_status.json`：关机监控器状态，包括最终 Excel 校验和强制关机命令是否已发出。

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
  "shutdown_after_complete": false,
  "shutdown_delay_seconds": 60
}
```

设为 `0` 可关闭定时汇报。第二轮最终 Excel 报告生成后默认自动关闭 Chrome；如需保留浏览器，加 `--no-close-chrome true`，或在配置中设置 `"close_chrome_after_report": false`。

自动关机默认关闭。只有当用户在提示词中明确要求“完成后关机 / 跑完关机”时，Codex 才能使用 `-ShutdownAfterComplete` 或 `--shutdown-after-complete true`。触发后，第二轮会先写入最终报表并确认 Chrome 已关闭，再启动独立 Node 关机监控器。监控器在第二轮 Node 进程退出后核验 Excel 与完成状态，随后执行：`shutdown.exe /s /f /t <秒数> /d p:0:0 /c "..."`。`/f` 会强制关闭阻塞应用，监控器在锁屏状态下仍会运行；默认延迟 60 秒，期间可用 `shutdown.exe /a` 取消。若监控器启动失败，第二轮脚本会直接发送相同的带 `/f` 强制关机命令作为回退。

## 输出文件

第二阶段最终生成；完整 Excel 报告写入成功后，默认通过 Chrome CDP 自动关闭采集浏览器：

- `fb_monitoring_filtered.xlsx`
- `fb_monitoring_filtered_summary.json`
- `collision_report.json`
- `audit_stats.json`
- `debug_rows.json`

第二阶段运行中会即时生成/刷新：

- `codex_progress_report.json`: Codex 定时进度快照，第二轮默认每 30 分钟刷新一次，并向 stdout 日志输出 `codex_progress_report`。
- `phase2_progress.json`: 轻量进度文件，每处理 1 个候选刷新一次；用于观察当前跑到哪个游戏/第几个候选。
- `phase2_autosave_state.json`: 完整恢复状态；在阶段开始、游戏边界、每条命中有效行、异常退出前刷新，包含已通过筛选的 `staged_rows`、人工复核行和统计。
- `phase2_autosave_summary.json`: 当前局部摘要，保持兼容旧观察命令。
- `partial_verified_rows.xlsx`: 已通过筛选行的可读暂存表；启动时先创建表头，每命中 1 条有效群组就立即保存。
- `phase2_autosave_last_error.txt`: 仅当暂存 Excel 写入失败时出现；通常是文件被 Excel 打开占用。
- `codex_task_complete.json`: 第二轮最终状态文件，记录完整报表是否生成、Chrome 是否关闭、是否请求关机及独立关机监控器信息。
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

1. 群组名称里的明确国家、地区、属地或大区语义。
2. 若命中多个国家/地区，但都属于同一业务大区，则输出该大区。例如 `MY + SG`、`TH + VN` 输出 `SEA`；`HK + TW` 输出 `EA`；`DE + FR` 输出 `EUR`。
3. 若命中多个跨业务大区信号，则视为地区冲突并留空。例如 `UAE + PH`、`US + BR`、`JP + TH`。
4. 未命中群名地区语义时，才使用高确定性语言辅助映射，例如 Thai -> TH、Vietnamese -> VN、Indonesian -> ID、Malay -> MY、Filipino -> PH、Arabic/Persian -> Middle East。
5. 若前四步仍无法确定，才从 About 页中明确标注的“所在地 / Location”字段推断地区：先识别国家/地区，再识别 `about_location_city_keywords` 中配置的高确定性城市；该兜底不得覆盖前述已得到的地区结果。
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

- 每处理 1 个候选，刷新 `phase2_progress.json` 和 `phase2_autosave_summary.json`，不重写 xlsx。
- 只有当某个群组通过全部筛选并进入有效结果时，才立刻刷新 `partial_verified_rows.xlsx` 和完整 `phase2_autosave_state.json`。
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
