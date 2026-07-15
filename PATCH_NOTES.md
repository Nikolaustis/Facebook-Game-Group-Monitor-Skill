# V5.5.0 补丁说明：GeoNames 上下文校验与地区优先级

## 修复的问题

V5.3/V5.4 中，群名模糊 GeoNames 位于语言和 About 所在地之前，导致普通词被真实地名“碰撞”后直接写入错误地区，例如：

- `Talk -> Town Talk, California`；
- `GREEN-TOWN -> Green Town, Punjab`；
- `วิน -> Winnipeg`；
- `jual -> Kampung Telok Jual, Perak`；
- `Ovenbreak / Classic` 等游戏系列词被当作地名。

## V5.5.0 修改

1. **地区优先级重排**
   - 群名明确地区；
   - About Location 本地规则；
   - About Location GeoNames；
   - 高确定性语言映射；
   - 群名 GeoNames 最后兜底。

2. **群名 GeoNames 精确名称约束**
   - query 必须与 GeoNames 主名称或 alternate name 完全一致；
   - 包含式/前缀式结果改为 `rejected_context_mismatch`；
   - About Location 查询不受该精确限制。

3. **多语言非地点词清洗**
   - 泰语：购买、出售、交换、讨论、账号、代码等；
   - 印尼语/马来语：`jual`、`beli`、`akun`、`pecinta`、`kuning` 等；
   - 英语/品牌：`Talk&Trade`、`GREEN-TOWN`、`Ovenbreak & Classic` 等；
   - 孤立非拉丁文字 token 不作为群名地点候选。

4. **游戏实体屏蔽扩大**
   - GeoNames 屏蔽集合包含本批次所有游戏名称、aliases、兄弟标题、IP roots 和受控变体；
   - 语言识别也屏蔽当前目标及兄弟标题。

5. **缓存和审计**
   - 缓存 namespace 升级为 `geonames-v5.5`；
   - 新增 `external_geocoder_rejected_context`；
   - 保留现有 `__geocoder_attempted_queries` 和错误原因。

## 兼容性

- 无新增 npm 依赖；
- 保留 V5.4.0 的 detail/manual_review 列结构；
- 保留 K/L `0.00%`、后台运行、断点恢复和强制关机。
