# V5.0.1 补丁说明：GeoNames endpoint 与错误状态修复

## 修复内容

本版本在 V5.0.0 基础上修复 GeoNames 调用持续 `network_error` 的问题：

- GeoNames endpoint 改为可配置，默认使用 `http://api.geonames.org/searchJSON`。
- 兼容 `https://secure.geonames.org/searchJSON`，不再使用错误的 `https://api.geonames.org/searchJSON`。
- 自动按 endpoint 选择 Node `http` / `https` 客户端。
- GeoNames API 返回错误时不再一律归为 `network_error`，会区分：
  - `geonames_account_not_enabled`
  - `geonames_username_error`
  - `geonames_api_error`
  - `geonames_http_error`
  - `geonames_endpoint_error`
  - `timeout`
  - `network_error`
- 临时网络错误、账号未启用、用户名错误、endpoint 错误不再写入 geocode cache，避免一次失败污染后续运行。
- GeoNames 缓存 key 新增 endpoint 维度，避免切换 `api.geonames.org` / `secure.geonames.org` 后误读旧结果。
- 改进同名城市歧义判断：对于 `Boston`、`San Diego` 等常见城市，若第一结果在相关性、行政层级和人口规模上明显领先，不再被小型同名地点误判为 `ambiguous`。
- 新增审计字段：
  - `__geocoder_attempted_queries`
  - `__geocoder_endpoint`
  - `__geocoder_error_reason`

## 覆盖后必须清理旧缓存

V5.0.0 已经把失败结果写入过 `runs/geocode_cache.json`。覆盖 V5.0.1 后，建议先执行：

```powershell
Get-ChildItem .\runs -Recurse -Filter "*geocode*cache*.json" | Remove-Item -Force
```

否则旧的 `network_error` 缓存仍可能影响结果。

---

# V5.0.1 补丁说明：GeoNames 外部地理解析兜底

## 新增内容

本版本在 V4.3.0 的基础上新增 GeoNames 外部地理解析接口，用于解决群组名称或 About/简介中的位置颗粒度细化到城市、省、州时，旧版只能依赖固定词典而无法锁定 `region` 的问题。

GeoNames 只作为地区判断的兜底验证层，不替代原有国家/地区关键词规则。默认优先级为：

1. 群组名称中的国家/地区/属地关键词；
2. 群组名称中的大区关键词；
3. 当群组名称仍无法给出国家/大区，但疑似包含城市、省或州名时，调用 GeoNames 验证；
4. 高确定性语言映射；
5. About 页“所在地 / Location”的原有国家、地区和内置高确定性城市兜底；
6. 当 About/简介中的所在地仍无法由本地规则判断时，调用 GeoNames 验证。

GeoNames 返回结果必须包含国家代码，并通过置信度和跨国歧义检查后才会写入 `region`。如果结果歧义、低置信度、超时或无结果，Skill 会保留空地区并写入审计字段，不会中断第二轮采集。

## GeoNames 用户名与 GitHub 上传

GeoNames 用户名没有写入公开任务模板。覆盖包将你的用户名放在：

```text
config/local/geonames.local.json
```

根目录新增 `.gitignore`，默认忽略：

```text
config/local/*.json
.env.local
```

因此这个本地凭据文件不建议、也不应上传 GitHub。如果你重新整理仓库，只保留 `assets/task_config.template.json` 中的 `local_config_file` 指向即可。

## 新增配置

`assets/task_config.template.json` 新增：

```json
"external_geocoder": {
  "enabled": true,
  "provider": "geonames",
  "local_config_file": "config/local/geonames.local.json",
  "username_env": "GEONAMES_USERNAME",
  "only_when_region_empty": true,
  "sources": ["group_name", "about_location"],
  "max_queries_per_group": 4,
  "max_rows": 5,
  "min_confidence": 0.75,
  "ambiguity_margin": 0.04,
  "timeout_ms": 8000,
  "rate_limit_ms": 1200,
  "cache_file": "runs/geocode_cache.json"
}
```

也可以不使用本地 JSON，改为 Windows 环境变量：

```powershell
$env:GEONAMES_USERNAME="Nikolaustis"
```

## 新增审计字段

正式明细新增：

- `__geocoder_provider`
- `__geocoder_status`
- `__geocoder_source`
- `__geocoder_query`
- `__geocoder_country_code`
- `__geocoder_place_name`
- `__geocoder_admin1`
- `__geocoder_confidence`

常见 `__geocoder_status`：

- `accepted`：GeoNames 结果通过验证并用于地区判断；
- `ambiguous`：多个跨国结果接近，未采用；
- `low_confidence`：返回结果置信度不足，未采用；
- `no_result`：无可用地理结果；
- `timeout` / `network_error` / `api_error`：外部接口异常，主采集继续；
- `not_needed`：原有规则已经确定地区，不需要调用 GeoNames。

## 更新文件

- `scripts/phase2_collect_details.js`
- `assets/task_config.template.json`
- `config/local/geonames.local.json`
- `.gitignore`
- `package.json`
- `README.md`、`SKILL.md`、`PATCH_NOTES.md`、`覆盖说明.md`

---

# V5.0.1 补丁说明：蒙古语与俄语西里尔文区分

## 问题修复

此前语言识别将所有西里尔字母都归入 `Russian`。蒙古语同样主要使用西里尔字母，导致蒙古玩家群组中的可见发言被错误标记为俄语。

## 新的识别规则

- `Ө/ө`、`Ү/ү` 是蒙古语的直接强证据；出现后优先输出 `Mongolian`，不再落入通用西里尔字母的 `Russian` 规则。
- 对于没有 `Ө/Ү` 的短蒙古语发言，使用高确定性蒙古语词组兜底，例如 `сайн байна`、`байна уу`、`баярлалаа`、`тоглоом`、`тоглогч`、`зарна`、`авна`、`солно`。
- 只有没有上述蒙古语证据的通用西里尔文本，才回退标为 `Russian`。
- `Mongolia`、`Mongolian`、`Монгол` 等地理词仍主要属于地区判断证据；英文地理词不会单独把语言判为蒙古语。
- 讨论区前五条逐帖判断的优先级保持不变；若不同帖子分别具有明确俄语和蒙古语证据，仍输出 `Mixed`。

## 更新文件

- `scripts/phase2_collect_details.js`
- `assets/task_config.template.json`
- `references/judgement_rules.md`
- `references/xlsx_schema.md`
- `README.md`、`SKILL.md`、`agents/openai.yaml`、`package.json`

---

# V4.2.0 补丁说明：锁屏可用的独立强制关机监控器

## 问题修复

此前第二阶段在主 Node 采集进程内部直接调用 `shutdown.exe /s /t <秒数>`。该方式没有 `/f`，当锁屏后仍有前台应用或交互会话阻塞关机时，Windows 可能无法按计划完成关机。

## 新的关机链路

当且仅当用户明确开启 `-ShutdownAfterComplete` 或 `--shutdown-after-complete true` 时，第二阶段现在按以下顺序执行：

1. 写入完整 Excel 报表。
2. 通过 CDP 关闭本次采集 Chrome，并确认关闭成功。
3. 写入 `codex_task_complete.json`。
4. 启动独立的 Node 监控器 `scripts/conditional_shutdown_watcher.js`，并将其与主采集进程脱离。
5. 监控器等待第二阶段 Node 进程退出，随后核验最终 Excel、完成状态和一次性 token。
6. 校验通过后，监控器执行：

```text
shutdown.exe /s /f /t <秒数> /d p:0:0 /c "FB group monitoring finished. System will shut down."
```

`/f` 会强制关闭阻塞关机的应用。监控器不依赖已解锁的交互桌面，因此锁屏时仍能继续等待并发送关机命令。

如独立监控器因意外原因无法启动，主第二阶段脚本会回退为直接执行同一条带 `/f` 的强制关机命令；不会静默降级为非强制关机。

## 新增/更新文件

- `scripts/conditional_shutdown_watcher.js`：独立关机监控器。
- `scripts/phase2_collect_details.js`：启动监控器，并将旧的直接非强制关机改为带 `/f` 的回退路径。
- `scripts/start_background_task.ps1`：后台状态中加入强制关机与监控器状态文件信息。
- `scripts/show_background_task_status.ps1`：可直接显示监控器状态。
- `SKILL.md`、`README.md`：更新关机顺序、命令和状态文件说明。

## 新增状态文件

启用完成后关机时，会在当前 run 目录生成：

```text
conditional_shutdown_watcher_status.json
```

其中会记录：监控器 PID、被监控的第二阶段 PID、Excel/完成状态校验结果、是否已发送 `shutdown.exe /s /f` 命令，以及失败原因（若有）。

## 使用与取消

命令保持不变：

```powershell
npm run phase2:bg -- -Index ".\runs\demo\phase1_index.json" -RunDir ".\runs\demo" -Config ".\runs\demo\task_config.json" -ShutdownAfterComplete -ShutdownDelaySeconds 60
```

默认延迟仍为 60 秒。发送关机命令后，可在倒计时内运行：

```powershell
shutdown.exe /a
```

取消。

---

# V4.1.0 补丁说明：About 所在地末级地区兜底

本次补丁在既有 V4.0.0 地区规则后新增一个**末级兜底**：当群组名称中的国家/地区/大区语义、同业务大区归并以及允许的语言映射都无法确定 `region` 时，第二阶段会从已打开的 About 页面中解析明确标注的“所在地 / Location”字段。

- 先识别所在地文本中的国家/地区或大区。
- 国家/地区未命中时，再识别 `about_location_city_keywords` 中的高确定性城市，并映射到既有地区输出规则。
- 此规则不会覆盖已由群组名称或允许语言映射得到的地区。
- 若群名存在跨业务大区冲突而无法归类，About 所在地可作为最终可信位置证据解决冲突。
- 新增审计列：`__region_location`。`__region_source` 新增 `about_location_country_keyword`、`about_location_city_keyword`、`about_location_region_keyword`；`__region_keyword_hits` 会标记 `group_name:` 与 `about_location:` 证据来源。
- `manual_review` sheet 增加 `about_location` 列。
- 新增可配置项 `about_location_city_keywords`，用于扩展特定市场的城市映射。

覆盖文件：

- `scripts/phase2_collect_details.js`
- `scripts/finalize_partial_xlsx.js`
- `assets/task_config.template.json`
- `package.json`
- `SKILL.md`
- `README.md`
- `references/judgement_rules.md`
- `references/xlsx_schema.md`
- `PATCH_NOTES.md`

---

# Patch Notes - V4.0.0

本次版本将 Skill 从 `fb-group-monitor-v3.6.7` 升级为 `fb-group-monitor-v4.0.0`，核心改动是优化 `region` 归并逻辑，解决同一业务大区下多个国家/地区同时命中时被误判为跨区冲突的问题。

## 本次改动

1. 新增同业务大区多命中折叠规则
   - 单一国家/地区命中时，仍按既有规则输出。
   - 如果同一群名同时命中多个国家/地区，但它们都属于同一个业务大区，则输出对应业务大区。
   - 例如：`MY + SG`、`TH + VN`、`ID + PH` 输出 `SEA`；`HK + TW` 输出 `EA`；`DE + FR` 输出 `EUR`。

2. 保留跨业务大区冲突置空规则
   - 如果命中项跨业务大区，仍输出空 `region`，并把 `__region_source` 标为 `keyword_conflict`。
   - 例如：`UAE + PH`、`US + BR`、`JP + TH` 不强行归并。

3. 新增地区来源标记
   - 同一业务大区内多命中折叠时，`__region_source` 输出：
     - `country_keyword_same_business_region`
     - `region_keyword_same_business_region`
   - `__region_keyword_hits` 仍保留每个命中项，便于人工审计。

4. 新增 EA 直接大区关键词
   - `direct_region_keywords` 新增 `EA`，覆盖 `east asia`、`eastern asia`、`east asian`、`东亚`、`東亞`。

5. 版本号更新
   - `SKILL.md`：`fb-group-monitor-v4.0.0`
   - `README.md`：`FB Game Group Monitor Skill V4.0.0`
   - `package.json` / `package-lock.json`：`4.0.0`

## 覆盖文件清单

```text
SKILL.md
README.md
PATCH_NOTES.md
package.json
package-lock.json
assets/task_config.template.json
references/judgement_rules.md
references/quality_checklist.md
references/xlsx_schema.md
scripts/phase2_collect_details.js
scripts/fix_one_piece_region_labels.js
```

## 验证建议

覆盖后在 Skill 根目录执行：

```powershell
node --check .\scripts\phase2_collect_details.js
node --check .\scripts\fix_one_piece_region_labels.js
node -e "JSON.parse(require('fs').readFileSync('.\\package.json','utf8')); JSON.parse(require('fs').readFileSync('.\\assets\\task_config.template.json','utf8')); console.log('json ok')"
```
