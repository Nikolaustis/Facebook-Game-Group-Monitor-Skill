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
