# V5.3.0 补丁说明：游戏名称隔离与 K/L 百分比格式

## 问题 1：游戏标题被发送给 GeoNames

V5.2.x 虽然尝试移除标准游戏名，但只使用了 canonical game_name 和批次游戏名，未完整覆盖 aliases、CamelCase 拆分、受控变体与 IP 根词。以 `CookieRun Kingdom` 为 canonical 名时，`Cookie` 仍可能残留并被 GeoNames 解析为美国地名，造成 North America 假阳性。

## 修复 1

- 为每个游戏生成独立的标题屏蔽集合：正式名称、aliases、受控标题变体，以及长度足够的 IP 根词。
- 自动拆分 CamelCase，例如 `CookieRun Kingdom -> Cookie Run Kingdom`。
- GeoNames 候选抽取前先从原始群名删除完整标题，再执行 token 级二次清理。
- 当前游戏名称不得进入 `__geocoder_query` 或 `__geocoder_attempted_queries`。
- 缓存命名空间升级为 `geonames-v5.3`。

## 问题 2：英文游戏标题干扰语言识别

群名和帖子中的英文游戏标题会增加 English 字母及关键词分数，可能把 `Cookie Run Kingdom ESPAÑOL` 之类群组误标为 English。

## 修复 2

- 群名、About 用户文本、帖子样本和 snippet 进入语言识别前，先删除当前游戏正式名称、aliases 和受控变体。
- 讨论区仍保持“前五条玩家发言优先”的既有规则，但游戏标题不再计入任何语言证据。

## 问题 3：K/L 列显示为 General 小数

部分暂存或历史导出链路未写入百分比样式，导致 K/L 显示为小数或科学计数法。

## 修复 3

- `phase2_collect_details.js` 的暂存表与正常最终表对 K/L 公式单元格写入 `0.00%`。
- `finalize_partial_xlsx.js` 的恢复最终表同步写入 `0.00%`。
- XLSX 写入显式启用 `cellStyles: true`，并为 K/L 列写入百分比列格式。

## 保留能力

V5.2.2 的孤立 ID 保护与 About 地区冲突裁决、V5.2.1 的人工复核门槛、V5.2.0 的 GeoNames 安全过滤、V5.1.0 的自动启用、蒙古语识别、断点恢复与强制关机均保留。
