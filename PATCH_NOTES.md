# V5.6.0 补丁说明：GeoNames 多语种停用词与地名抽取安全升级

## 核心修改

1. 扩充英语、泰语、越南语、印尼语/马来语、西语、葡语、法语、中文和阿语停用词。
2. 新增上下文受限地名：普通词/品牌词不得孤立查询，带行政区或国家上下文的完整短语仍可使用。
3. 游戏名称融合 token 整体丢弃，避免 `PokeMonedas -> edas`、`Pok'emon -> Pok`。
4. 多词地名不再降级为任意单词；保留 `San Diego / El Paso / San Antonio / Fort Worth`。
5. 群名单 token 结果增加行政层级/人口门槛，默认人口下限 50,000。
6. 屏蔽高风险孤立 ISO 代码：`ID / IN / IT / NO / TO / ME / MY / LA / DE / TR / TM / AT / IS / BE`。
7. 新增 `Hàn Quốc / LATHAM / GDL / SEQ+Brisbane / Arab(s)` 等本地别名。
8. `Georgia` 单独出现不再直接判为欧洲。
9. 缓存升级为 `geonames-v5.6`。
10. 新增统计 `external_geocoder_context_restricted_queries`。

## 兼容性

- 基于 V5.5.0 累计升级，保留 V5.4.0 人工复核表对齐、K/L 百分比格式、断点恢复、GeoNames 自动启用和锁屏强制关机。
- 不新增 npm 依赖。
