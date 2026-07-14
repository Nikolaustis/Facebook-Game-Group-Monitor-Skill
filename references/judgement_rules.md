# 判定与过滤规则（V5.3.0）

## A. 第一轮：搜索与深翻页
1. Skill 支持一次任务同时检索多个游戏。每个游戏必须独立生成搜索计划，不能把某个游戏的特殊变体扩散到其他游戏。
2. 对所有游戏自动生成低风险标题变体：
   - 原始标题，例如 `All Star Tower Defense`。
   - 标点/冒号/破折号归一标题，例如 `Ragnarok : The New World` -> `Ragnarok The New World`。
   - 少空格/去空格紧凑标题，例如 `All Star Tower Defense` -> `Allstar Tower Defense`、`All Star TowerDefense`、`Allstar TowerDefense`。
3. 禁止自动生成过宽关键词，例如 `Anime`、`Ragnarok`、`Tower Defense`、`All Star`。
4. `connector_x` 是高风险受控变体，默认关闭。只有配置 `title_variant_overrides[game].search_variants` 后才可搜索，例如 `All Star X Tower Defense`。
5. 原始标题自带 `X` 的游戏，例如 `Anime Rangers X`、`Ragnarok X: Next Generation`，`X` 是正式标题 token，不能删除，也不能被当作可选连接符。
6. `seed_group_urls` 只表示“强制进入第二轮检查”，不代表自动进入最终 `detail`。
7. 第一轮候选必须保留审计字段：`source_query`、`query_variant_type`、`source_game_name`、`source_is_seed_url`、`source_queries`、`query_variant_types`。
8. 深翻停止条件满足任一项即可进入人工确认：
   - 页面提示无更多结果。
   - 连续 3 次下滑无新增群组。
   - 搜索结果列表不再增长。
9. 到达停止条件后，必须先询问用户：“可以停止，继续 / 继续深翻”。用户未确认前，不得进入第二轮。

## B. 第二轮：详情采集
1. 候选处理顺序：
   - 先读取搜索卡片中的成员规模。
   - `group_size < 100`：不进入 `/about`，不进入最终输出。
   - `group_size >= 100`：进入群组详情页采集。
2. `/about` 最多尝试 2 次，失败且无法获得核心指标时不得输出。
3. 若第一轮候选来自 `seed_group_urls` 且卡片没有群名，第二轮应从 Facebook 页面标题或群组标题中补取 `group_name` 后再判定。
4. 语言识别必须优先参考讨论区前五条玩家发言；群组名称为辅助；“关于这个小组”只采集社区成员手写文本，且优先级最低。
5. Facebook 中文界面、导航、按钮、固定提示、系统结构文案不得作为语言判断证据。

## C. 相关性规则
1. `exact_phrase_in_group_name`：群名按词序完整命中原始标题或明确 alias，是强正样本。
2. `compact_title_in_group_name`：群名命中去空格/少空格后的目标标题，例如 `Allstar TowerDefense`，可作为正样本继续进入最终筛选。
3. `connector_x_title_in_group_name`：群名命中配置 allowlist 中允许的 X 连接变体，例如 `All Star X Tower Defense`，可作为弱正样本继续进入最终筛选，但必须使用更高活跃门槛。
4. `exact_phrase_in_full_text`：仅 about/snippet/full_text 命中目标标题，进入人工复核，默认不直接进入最终输出。
5. `ip_root_in_group_name`：群名只命中 IP 大词根但未命中完整标题，进入人工复核，默认不直接进入最终输出。
6. 多游戏批量检索时，系统必须自动把同批次其他游戏合并进当前游戏的 `sibling_titles`。如果配置中已有 `sibling_titles`，则与自动同批次兄弟标题合并。
7. `group_name` 命中兄弟游戏标题时，兄弟排斥优先于弱变体命中和 full_text 命中。
8. 禁止以下宽松规则：
   - 3 个 token 命中 2 个就算相关。
   - 2 个 token 命中 1 个就算相关。
   - 只要出现 IP 词根就进入最终明细。

## D. 输出门槛
最终 Excel 的 `detail` 工作表仅保留全部满足以下条件的记录：
- `group_size >= 100`
- `is_relevant = yes`
- 若配置了 `allowed_language_signals`，则 `language` 必须命中允许列表。
- 若配置了 `allowed_regions`，则 `region` 必须命中允许列表。
- 满足活跃门槛之一：`today_posts >= threshold` 或 `week_new_fans >= threshold`。

### 变体专用门槛
- `compact_title_in_group_name` 默认使用全局活跃门槛。
- `connector_x_title_in_group_name` 默认使用更高门槛：
  - `group_size >= 1000`
  - 且 `today_posts >= max(global threshold, 20)` 或 `week_new_fans >= max(global threshold, 50)`
- 如果 `title_variant_overrides` 中为该 `connector_x` 变体配置了 `min_group_size`、`min_today_posts`、`min_week_new_fans`，以配置值为准，但不得低于全局 threshold。

## E. 语言与地区判定
1. `language` 必须参考群组名称、讨论区前五条玩家发言，以及用户手写 about 文本。
2. 讨论区前五条玩家发言是语言识别的最高优先级。
3. 讨论区前五条必须先逐条识别语言，再汇总判断；若前五条中出现两个以上可信语言，`language = Mixed`。无正文帖、图片/视频帖、或只有极短正文且只抓到 Facebook UI 文案的帖子不得计入语言样本。
4. 群组名称可作为语言辅助信号，但不得单独覆盖讨论区中更明确的语言证据。
5. about 文本只允许使用社区成员手写内容；如果 about 区域只有 Facebook UI 结构文本，则不得参考。讨论区同理，不得把中文界面的按钮、时间、互动统计、评论入口、翻译入口作为 `Chinese` 证据。
6. 蒙古语与俄语的西里尔字母必须区分：`Ө/ө`、`Ү/ү` 为蒙古语的直接强证据；不含这些字母的文本可通过高确定性蒙古语词组（如 `сайн байна`、`байна уу`、`баярлалаа`、`тоглоом`、`тоглогч`、`зарна`、`авна`、`солно`）识别为 `Mongolian`。只有缺少这些蒙古语证据的通用西里尔文本，才可作为 `Russian`。地理名称 `Mongolia` / `Mongolian` 不得单独成为语言证据。
7. `region` 采用“国家/地区识别 -> 业务区域归并输出 -> 同大区多命中折叠”的三层规则。优先从 `group_name` 中识别明确国家、地区、属地、大区、受控别名或国旗 emoji。短代码允许紧贴非拉丁文字，但不得在普通英文单词内部误命中。
8. 东亚与东南亚单一具体国家/地区按自身输出。若群名同时命中多个不同地区，必须先用 About 所在地裁决；只有 About 无法裁决时，同一业务大区的多命中才折叠为 `EA`、`SEA` 或 `EUR`，跨业务大区冲突保持空值。
9. Middle East、Central Asia、South Asia、North America、LATAM、Africa、EUR、Oceania 按业务大区归并；BR 单列；TR、NL、DE、FR、IT、PL、RU 单列。若多个命中项都属于同一业务大区，则输出该业务大区，例如 `DE + FR` 输出 `EUR`。
10. 若命中项跨业务大区，则视为 `keyword_conflict` 并留空，例如 `UAE + PH`、`US + BR`、`JP + TH`。
11. 若明确识别到非洲国家，即使语言是 Arabic，也必须优先输出 `Africa`；Egypt 例外，归入 `Middle East`。
12. 未命中群名地区语义时，仅允许高确定性语言辅助映射：Thai -> TH、Vietnamese -> VN、Indonesian -> ID、Malay -> MY、Filipino -> PH、Lao -> LA、Khmer -> KH、Burmese -> MM、Arabic/Persian -> Middle East。
13. English、Spanish、Chinese、French、Portuguese、Mixed 不得单独映射为国家地区。
14. 若群名本地规则与 GeoNames 群名验证、允许的语言映射均无法确定 `region`，才可读取 About 页中明确标注的“所在地 / Location”字段：先识别国家/地区，再识别 `about_location_city_keywords` 中配置的高确定性城市。该位置兜底不得覆盖前述已得到的地区结论；若群名存在跨大区冲突，About 所在地可作为最终可信位置证据重新判定。
15. 不设置语言或地区硬限制时，所有地区和语言均可收录，但必须展示识别结果与来源字段。

## F. 不输出规则
以下记录不得进入 `detail` 工作表：
- 成员数 `< 100`。
- 明确不相关。
- `group_name` 命中兄弟游戏标题。
- `match_type = exact_phrase_in_full_text`。
- `match_type = ip_root_in_group_name`。
- `connector_x_title_in_group_name` 未通过变体专用门槛。
- 不满足已配置的语言或地区限制。
- `/about` 失败且无法获取核心指标。
- 同一 `group_url` 归属冲突且最高分并列。

## G. 人工复核队列
人工复核是相关性复核，不是低质量候选暂存区。以下弱相关记录只有在先通过数据门槛后，才进入 Excel 的 `manual_review` 工作表，且不得混入 `detail`：
- 仅 `full_text` 命中目标完整标题。
- `group_name` 命中 IP 大词根但未命中目标完整标题。
- `group_name` 命中兄弟游戏标题。
- `match_type = exact_phrase_in_full_text`。

人工复核数据门槛与普通命中一致：
- `group_size >= 100`；
- 且 `today_posts >= threshold` 或 `week_new_fans >= threshold`。

任何一项不达标时直接丢弃，不进入 `manual_review`。`manual_review` 至少包含以下字段：
- `snapshot_date`
- `game_name`
- `group_name`
- `group_url`
- `group_size`
- `today_posts`
- `week_new_fans`
- `language_signal`
- `region`
- `about_location`
- `match_type`
- `matched_phrase`
- `negative_hit`
- `review_reason`
- `source_query`
- `query_variant_type`
- `source_is_seed_url`
- `variant_threshold_applied`

## H. 跨游戏去重归属
1. 同一 `group_url` 只允许在 `detail` 工作表输出一条。
2. 如果同一群组被多个游戏同时命中：
   - 分数最高者保留。
   - 最高分并列时全部丢弃，并写入 `collision_report.json`。
3. 分数优先级：
   - `exact_phrase_in_group_name` 最高。
   - `compact_title_in_group_name` 次之。
   - `connector_x_title_in_group_name` 再次之。
   - `exact_phrase_in_full_text` 和 `ip_root_in_group_name` 默认只进人工复核。

## I. action 判定
- `existed_last_month=yes` -> `update`
- `existed_last_month=no` -> `add`
- `existed_last_month` 缺失 -> `action` 留空

## J. action_reason 规则
输出记录必须填写 `action_reason`，示例：
- `today_posts>=10; existed_last_month=yes`
- `week_new_fans>=10; existed_last_month=no`
- `today_posts>=20; existed_last_month=missing`

## K. risk_level 规则
- `low`：完整标题命中或紧凑标题命中于群名，且关键字段完整。
- `medium`：`connector_x_title_in_group_name`，或字段部分缺失但结论明确。
- `high`：仅靠弱信号命中，或存在冲突边界；高风险记录建议直接进入人工复核或丢弃。

16. GeoNames 启用顺序：任务配置显式开关 > 本地配置显式开关 > 检测到本地/环境变量用户名时自动启用；显式 false 不得被自动启用覆盖。


## V5.2 地区精度补充规则

17. 两到三位国家/地区代码只在原始文本中以大写代码出现且满足拉丁文字边界时生效；小写介词、普通单词内部片段和 Unicode 兼容符号不得命中。
18. 商标/版权符号必须在 NFKC 归一化前移除，尤其禁止 `™ -> TM` 触发土库曼斯坦。
19. 群名中的高确定性城市/省州映射位于 GeoNames 前，至少覆盖 `Québec`、`台中`、`台南/臺南`、`Trójmiasto`、`SoCal`；`Danmark` 作为高确定性国家别名映射到 `EUR`。
20. GeoNames 查询必须通过泛词和句子安全检查。交易、礼物、邀请、社群、等级、英文翻译句等非地点词不得请求 GeoNames。
21. 多词地点优先保持完整短语；若首个结果歧义，可继续尝试后续更明确候选。
22. `unsafe_query` 不得写入缓存或地区结果，并计入 `external_geocoder_filtered_queries`。


## V5.2.1 人工复核门槛补充

23. `manual_review` 写入必须发生在规模与活跃阈值验证之后。
24. `audit_stats.json` 必须分别记录人工复核候选数、因规模不达标淘汰数、因活跃度不达标淘汰数。
25. 人工复核表必须展示 `group_size`、`today_posts`、`week_new_fans`，避免人工复核无业务价值的候选。


## V5.2.2 ID 与多地区冲突补充规则

23. 孤立 `ID` 不得作为印度尼西亚国家代码；即使旧任务配置仍包含该关键词，也必须在运行时过滤。
24. 印度尼西亚可由 `Indonesia / Indo`、印尼语、印尼城市、🇮🇩、About Location 或 GeoNames 判断。
25. 群名的 `keyword_hits` 出现两个或更多不同地区时，必须先解析 About 所在地；About 结果只有与至少一个群名地区证据处于同一国家或同一业务大区时才可裁决。
26. About 无法裁决时，同业务大区多命中可回退为大区；跨业务大区不得由语言映射强行覆盖。


## V5.3.0 游戏名称隔离规则

- GeoNames 只能接收从群名中删除当前游戏正式名称、aliases、受控变体与高确定性 IP 根词后的剩余地点候选。
- 当前游戏标题的组成词不得单独成为 GeoNames query。
- 语言识别对群名、About 用户文本、discussion posts 和 snippet 使用同一标题屏蔽集合。
- 屏蔽只用于地区候选和语言识别，不改变相关性匹配使用的原始群名。
