# GeoNames 过滤配置说明

GeoNames 仅用于本地确定性规则、About Location 和语义裁决仍无法确认的地点候选。

## 禁止查询

- 游戏名、别名、兄弟标题、IP root 和其残词。
- 买卖、交换、社区、账号、聊天、邀请码、活动等多语种功能词。
- 孤立的非拉丁昵称、人名或普通词。
- `Drama`、`Solo`、`Orange`、`Victoria`、`Georgia`、`Phoenix`、`Classic`、`Beta`、`Mania`、`League` 等高歧义词。

## 允许查询

- 原文支持的完整地点短语。
- 明确城市 + 州/省/国家上下文。
- About Location 中清晰标注的地点。
- 语义模型高置信度判定为地点且候选短语可在来源文本中验证。

## 结果接受

- query 与主名称或 alternate name 精确匹配。
- 单 token 必须满足行政层级、首府或人口门槛。
- 与高确定性语言或群名地区冲突时，需要 About 或明确地点上下文支持。
- 多地区并置时按业务区域折叠或保持未映射，不能任意选择第一条。
