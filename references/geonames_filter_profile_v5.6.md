# GeoNames 群名过滤配置 V5.6

本文件记录 V5.6 内置的群名地点候选安全策略。运行时规则位于 `scripts/phase2_collect_details.js`。

## 硬停用词类别

- 英语：账号、买卖、交易、社区、邀请码、团战、商店、活动、等级、更新、新闻等。
- 泰语：`ซื้อ / ขาย / ซื้อขาย / แลกเปลี่ยน / พูดคุย / ไอดี / รหัส / กลุ่ม / ศูนย์รวม` 等。
- 越南语：`mua / bán / mua bán / trao đổi / giao lưu / cộng đồng / hội / nhóm / quốc tế / toàn quốc` 等。
- 印尼语/马来语：`jual / beli / akun / pecinta / komunitas / lapak / tukar / pemain / resmi` 等。
- 西语/葡语/法语：`compra / venta / intercambio / comunidad / troca / venda / groupe / amis / échange` 等。
- 中文：交易、买卖、交换、交友、讨论、社群、账号、代练、代储、活动、攻略、限定等。
- 阿语：`بيع / شراء / حساب / مجموعة / مجتمع / لاعبين / عشاق / متجر / تبادل / فيفا` 等。

## 上下文受限词

以下词不能作为群名中的孤立地点候选，但可保留在明确的完整地点短语中：

```text
Bay, Santa, Solo, Mobile, Town, Orange, Victoria, Georgia, Phoenix,
Classic, Kingdom, Beta, Mania, League, World, Global, Hendo, Latham,
Kuning, Green, Yellow, Red, Blue, Black, White
```

示例：

- `Orange`：拒绝；`Orange County`：允许完整短语。
- `Victoria`：拒绝；`Victoria BC`：允许完整短语。
- `Santa`：拒绝；`Santa Rosa`：允许完整短语。
- `Georgia`：不本地强判；需要 `Georgia country / საქართველო`、About 或 GeoNames 上下文。

## 地名抽取约束

1. 含游戏名称/别名/IP root 的融合 token 整体删除。
2. 多词地点不降级为任意单词。
3. 群名单 token 必须满足 GeoNames 精确名称匹配，并且：
   - 为国家、ADM1、首府/PPLA 等高层级实体；或
   - 人口不少于 `external_geocoder.group_name_single_token_min_population`，默认 50,000。
4. About Location 是明确位置字段，不应用群名的普通词上下文限制。

## 高风险短代码

以下代码不允许单独判区：

```text
ID, IN, IT, NO, TO, ME, MY, LA, DE, TR, TM, AT, IS, BE
```

完整国家名、国旗、语言、城市、About 所在地或 GeoNames 仍可提供地区证据。
