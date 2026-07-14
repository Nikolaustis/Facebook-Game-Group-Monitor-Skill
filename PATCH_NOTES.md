# V5.2.1 补丁说明：人工复核先通过数据门槛

## 问题

V5.2.0 在相关性判断为 `manual_review` 后，会先写入人工复核队列，再执行成员规模和活跃度判断。由于弱相关记录随后直接结束处理，导致部分规模或活跃度不达标的群组仍保留在 `manual_review`。

## 修复

- 人工复核候选先执行与普通命中一致的数据门槛：
  - `group_size >= 100`；
  - `today_posts >= threshold` 或 `week_new_fans >= threshold`。
- 未达门槛的弱相关候选直接丢弃，不进入人工复核。
- `manual_review` 新增 `group_size`、`today_posts`、`week_new_fans`。
- 新增审计统计：
  - `manual_review_candidates`
  - `manual_review_dropped_threshold`
  - `manual_review_dropped_group_size`
  - `manual_review_dropped_activity`
- 断点恢复生成 Excel 时同步保留新增人工复核列。

## 不变内容

相关性规则不变：完整标题或受控变体仍进入严格 `detail` 流程；仅 IP root、仅 full text、兄弟标题等仍属于人工复核类型。V5.2.0 的 GeoNames 地区精度修复全部保留。
