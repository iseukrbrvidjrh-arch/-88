# 项目 B：SceneLingo 现状审计

> 本报告基于本地源码、设计文档和测试文件静态审计。没有安装依赖、启动真实应用、执行迁移或运行测试；“测试覆盖”表示存在对应测试代码，不表示本轮通过。

## 1. 总体判断

SceneLingo 已形成可运行方向明确的 Python/FastAPI + 原生 Web + SQLite 模块化单体，核心闭环已有较多实现：字幕导入、字幕浏览、候选词/词条、IPA、macOS TTS、复习、进度、Qwen AI 聊天和本地费用记录。其优势是本地优先、云端调用有用户确认和 send-plan 预览、数据模型强调事实与投影分离。

但设计文档的范围大于可由本轮静态证据直接确认的产品完成度；P1 的表达训练、导出/恢复、词条归档、进阶统计等不可当作已完成。当前工作树有用户已有未提交改动：`app/web/app.js`、`app/web/index.html`、`app/web/style.css`、`packaging/*`、`app/web/daily-greeting.js`、`app/web/layout-preferences.js`、`prototype/v0.3-ui/`；本研究未修改这些内容。

## 2. 功能状态矩阵

| 模块 | 状态 | 用户入口与流程 | 代码/持久化证据 | 测试证据 |
|---|---|---|---|---|
| 字幕导入 | 已实现，核心路径有测试 | 前端文件选择 → multipart API → 解析/统计 → 事务写入 → 列表 | `app/web/index.html`、`app/web/app.js`、`app/api/subtitles.py`、`app/services/subtitle_import.py`、`app/domain/subtitle/parser.py`、`app/repositories/subtitles.py`；`subtitle/cue/subtitle_token` 迁移 | `tests/test_task004.py`、`test_task008.py`、browser tests；未本轮执行 |
| 字幕解析/词形统计 | 已实现 | SRT/VTT 文本解析、清洗、无效 cue 跳过、候选统计 | `app/domain/subtitle/parser.py`、`tokens.py`、`app/services/subtitle_query.py` | task 004/008 等文件 |
| 字幕展示/继续学习 | 已实现但 UI 复杂度需继续验收 | 字幕库 → cue 浏览 → 选中 cue；设置保存最后位置 | `app/api/subtitles.py`、`app/api/progress.py`、`app/services/progress.py`、`web/app.js`、`app_setting` | task 008/011/013 与 browser 脚本 |
| 本地 IPA | 已实现 | 词条/候选查询本地词典 | `app/integrations/ipa_dictionary.py`、`app/data/ipa/en_US.txt`、license 文件、`app/services/pronunciation.py` | task 009/相关单元测试存在 |
| 本地朗读 | 已实现，平台依赖 | 点击朗读 → 后端调用 macOS `say`/音频适配器 | `app/integrations/macos_tts.py`、`app/services/speech.py`、`app/api/speech.py` | `tests/test_task009.py` |
| 词汇库/语境 | 已实现核心，归档/高级表达不足 | 候选或 cue → 加入 → 去重并合并语境 → 词条详情 | `app/api/vocabulary.py`、`services/vocabulary.py`、`repositories/vocabulary.py`、`learning_item/context_ref` 迁移 | task 006/008 等 |
| 释义/翻译/解释 | 部分实现，云端依赖 | 词/句操作 → 本地/缓存优先 → 用户确认后调用 Qwen | `app/services/subtitle_query.py`、`app/integrations/qwen_gateway.py`、`ai_cache` 迁移 | AI/字幕测试存在；上游真实调用未验证 |
| 复习/SRS | 已实现 MVP | 复习页 → 拼写/词义回忆 → 评分 → 幂等保存 → 更新状态 | `app/domain/review/rules.py`、`services/review.py`、`api/review.py`、`repositories/review.py`、`review_attempt/review_state` | `tests/test_task007.py`、`test_task011.py` 等 |
| 跨日期掌握 | 已实现规则，实际长期效果未验证 | 成功日期去重，满足间隔条件后 mastered | `app/domain/review/rules.py`；设计规则见 `docs/03-数据库设计.md` §7 | 有日期/重启测试文件，但未执行 |
| AI 聊天 | 已实现，Qwen-only | 同意/配置 Key → 新会话 → 生成 send-plan → 预览 → 确认 → 流式 SSE → 保存/取消 | `app/api/ai.py`、`services/chat.py`、`services/ai_send_plan.py`、`repositories/chat.py`、`integrations/qwen_gateway.py`、`ai_conversation/ai_message` | task 010/011/012/013、browser scripts |
| AI 结果保存 | 已实现但需注意确认边界 | 选中回答 → 选择 word/phrase/sentence/note → 保存 | `app/services/vocabulary.py`、`api/vocabulary.py`、`learning_item` | task 012/013 |
| 费用记录 | 已实现 | AI 请求结束 → usage/字符估算 → 本地明细/汇总 | `app/api/ai.py`、`repositories/ai.py`、`cost_record` | AI task tests |
| 学习统计 | 部分实现 | 首页/记录查看聚合数据 | `app/api/progress.py`、`services/progress.py`、`repositories/progress.py` | task 011/013 |
| 备份/导出/恢复 | 文档规划或基础迁移备份，用户功能未确认 | 设计要求迁移前备份；没有证据证明完整用户导出/恢复流程 | `app/repositories/migrations/runner.py`、`docs/03-数据库设计.md` §11；设计中标为 P1 | 未发现完整用户验收证据 |
| 表达训练/发音评分 | 未发现完整实现证据 | 需求/架构提及表达练习或未来 P1，但未确认闭环 | `docs/02-系统架构设计.md`、`docs/03-数据库设计.md`；当前 review mode 仅 spelling/meaning | 未发现对应完整实现 |

## 3. 架构与数据流

架构文档 `docs/02-系统架构设计.md` 规定 `api → services → domain`，仓储与 integrations 作为适配器；源码目录基本遵循。`app/main.py` 是组合根，`app/repositories/database.py` 负责 SQLite 连接、WAL/FK/事务相关设置，迁移在 `app/repositories/migrations/{runner.py,versions.py}` 以 `PRAGMA user_version` 顺序执行。

物理迁移当前至少到 V7：字幕、cue、词形、词条/语境、复习、AI cache/cost/settings、AI conversation/message/context。`versions.py` 的 V7 还对 `cost_record` 做表重建以补充聊天关联；这说明迁移机制真实存在，也说明后续修改必须严格增量和备份。

AI 流程实际重点是“预览内容与执行内容一致”：`services/ai_send_plan.py` 创建一次性计划，`api/ai.py` 执行并通过 Qwen 网关流式返回；消息状态区分 pending/complete/incomplete/failed/cancelled。该设计是 SceneLingo 的重要资产。

## 4. 质量、风险和未验证项

1. **文档—实现落差**：逻辑模型包含若干扩展实体和 P1 目标，不能直接视为界面可用。
2. **原生 JS 状态复杂度**：`app/web/app.js` 集中承载多个页面、流式聊天、复习和设置；长期扩展可能出现状态耦合和回归风险。
3. **SQLite 迁移风险**：手写 SQL 和表重建透明可审查，但要求每次新迁移、旧库升级、失败回滚均有隔离测试。
4. **上游 AI 可用性**：`qwen_gateway.py` 为 Qwen 兼容 HTTP；真实 key、网络、SSE、usage、取消和价格口径本轮未验证。
5. **平台边界**：TTS 是 macOS 专属集成；软件目标也是 macOS，但打包脚本和实际安装环境仍需真实验收。
6. **测试结论限制**：存在 13 个 task pytest 套件及浏览器脚本，但本轮遵守只读和成本控制，未执行，因此只能标为“测试代码覆盖/实际验证待做”。
7. **隐私边界**：设计强调 Keychain、127.0.0.1、Host/Origin/token、AI 预览，但必须通过运行时和网络观测验证，而不是只看文档。

## 5. 保留价值

应保留：本地优先边界、词条与字幕语境快照、不可变复习历史 + 可重建状态、AI 两阶段发送计划、Qwen 网关隔离、迁移版本化、测试中的可注入时钟/假适配器。这些比简单增加页面数量更能支撑 SceneLingo 2.0。
