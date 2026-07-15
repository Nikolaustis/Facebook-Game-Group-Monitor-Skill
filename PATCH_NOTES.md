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
