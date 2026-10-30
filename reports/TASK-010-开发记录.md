# TASK-010 开发记录

- 状态：已完成（2026-10-30，项目负责人正式验收）
- 范围：千问唯一网关、Keychain、不可变发送计划、翻译/释义/语境解释、SQLite 缓存、费用明细和设置界面。
- 数据边界：只发送预览中的当前目标与可选当前语境；历史数固定为 0，附件为空；不读取完整字幕、学习数据库或聊天历史。
- 默认模型：用户于 2026-10-30 明确指定使用当前最高通用文本模型 `qwen3.8-max`，不会静默切换。
- 价格口径：`qwen3.8-max` 官方公示原价为输入 12 CNY/百万 token、输出 36 CNY/百万 token；价目版本 `aliyun-qwen3.8-max-2026-10-30`。来源：<https://help.aliyun.com/zh/model-studio/qwen3-8-max>（核查日期 2026-10-30）。估算不含活动折扣，不等同供应商账单。
- 接口口径：OpenAI 兼容 `POST {base_url}/chat/completions`。用户 2026-10-30 提供的按量付费凭证页面明确指定 `https://maas.qianwenaiapi.com/compatible-mode/v1`，因此将其设为本项目默认地址；仍可用 `SCENELINGO_QWEN_BASE_URL` 显式配置其他已批准的 HTTPS 兼容地址。不同计费方案的 Key 与 Base URL 必须配套，不能根据 Key 外观猜测地域。
- 测试：TASK-010 专项 20 项、全量回归 144 项通过；真实服务在 `127.0.0.1:18766` 启停与健康检查通过；前端 JavaScript 语法检查通过。
- 首次真实调用：2026-10-30 经用户明确授权，使用当时错误配置的旧 DashScope 地址向 `qwen-turbo` 发送 1 次已预览原创句子；上游返回 HTTP 429，映射为 `ai_rate_limited`，没有自动重试或模型切换。用户随后提供凭证页面截图，确认该 Key 应配套 `https://maas.qianwenaiapi.com/compatible-mode/v1`；该次旧地址调用未取得正文或 usage，不能作为有效验收。
- 修正后真实验收：2026-10-30 经用户再次明确授权，使用 `https://maas.qianwenaiapi.com/compatible-mode/v1` 和 `qwen3.8-max` 发送 1 次原创句子。返回译文“尽管雨已经停了，老电影院里仍隐约弥漫着湿石头和咖啡的味道。”；API usage 为输入 83、输出 167 tokens，按固定价目估算 0.007008 CNY。随后相同请求命中 `local_cache`，缓存 1 条、费用记录 1 条，没有第二次云端调用。
- 费用语义：`estimated_cost` 始终是本地估算，不是供应商正式账单。失败且上游未返回 usage 时，`usage_source` 与 `estimated_cost` 均保存为 `NULL`（未知），不得用零冒充已确认的零费用。
- 遗留限制：真实验收使用隔离临时数据库，不接触个人学习数据；估算费用不等于供应商最终账单；流式响应和聊天历史属于 TASK-011；价格会变化，升级价目须显式更新版本。
