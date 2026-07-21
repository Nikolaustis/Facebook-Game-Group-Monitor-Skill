# Excel 字段规范

第二轮输出 `fb_monitoring_filtered.xlsx`，包含：

- `detail`：正式有效记录。
- `manual_review`：通过规模与活跃门槛、但需要人工裁决归属的记录。

## 顺序原则

本包中 `phase2_collect_details.js` 的字段数组为唯一权威顺序。补丁不得重新排列上传基础包已经确定的字段。

`manual_review` 的开头必须与 `detail` 完全一致，便于整块复制粘贴；复核专属字段只允许追加在公共字段之后。

## 核心业务字段

包括快照日期、地区、语言、游戏名、群名、URL、group ID、成员数、今日帖子、周新增、活跃指数、规模增速、上月是否存在、action、风险、来源、相关性及确定性地区证据。

## GeoNames审计字段

必须连续保存 provider、status、source、query、attempted queries、endpoint、error reason、country code、place name、admin1 和 confidence。

## 语义模型审计字段

必须保存 provider、model、status、trigger、location intent、scope、confidence、candidate places、explicit regions、reason、cache、provider chain 和 fallback reason。

## 人工复核专属字段

保存语言信号、About所在地、匹配类型、命中短语、负向命中、复核原因、来源查询、查询变体、seed标记及变体门槛等。它们必须位于公共列之后。

## 格式

- 活跃指数：`today_posts / group_size`。
- 规模增速：`week_new_fans / (group_size - week_new_fans)`。
- 两列使用 `0.00%`。
- 缺失值保持空白，不写入 0 代替未知。
- URL 保持可点击文本格式。
