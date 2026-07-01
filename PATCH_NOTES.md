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
