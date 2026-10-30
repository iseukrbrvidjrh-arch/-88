# TASK-009 开发、测试、覆盖率及许可核查报告

- 状态：2026-10-30 自主验收通过，按授权暂不提交或推送。
- 功能：离线美式 IPA 查询、多读音候选、`'s` 基础词回退、缺失提示；macOS 单词/句子本地朗读、停止、重播与分类错误。
- 本机验证：`say`、`afconvert`、`afplay` 可用；原创短句实际启动播放并停止，临时文件清理为 0。
- 安全：所有子进程使用 argv 列表且无 `shell=True`；以 `-` 开头、空值、NUL 和超过 1,000 字符被拒绝；日志不记录朗读正文。
- 词典版本：`open-dict-data/ipa-dict` 提交 `972cd67dd5f96bc5660e28070cde26e3928abcd7`；`en_US.txt` SHA-256 `2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67`。
- 规模：125,927 条记录，按小写键去重后仍为 125,927；原创固定字幕 10/10 词形命中，覆盖率 100%。该结果仅代表测试样本，不代表真实字幕总体覆盖率。
- 专项样本：`record/read/present/lead/wind/resume` 返回多个候选；`mr.`、`u.s.`、多音节词命中；构造未知词缺失；断网查询由纯本地文件完成。
- 许可链：ipa-dict MIT（© 2016 dohliam）；cmudict-ipa MIT（© 2016 Lingliang Zhang，审查提交 `629483e...`）；CMUdict 独立再分发条款（© 1993–2015 CMU，审查提交 `7479086...`）。原文分别保存在 `app/data/licenses/`，完整说明见 `THIRD_PARTY_NOTICES.md`。
- 数据转换：SceneLingo 未再次转换，直接固定并打包上游 `data/en_US.txt`；上游说明该数据源自修改后的 cmudict-ipa 并加入重音标记。
- TTS 对比限制：系统 Samantha 语音可以播放测试词，但 macOS 不暴露最终音素序列；同形异音词的系统选音可能与界面第一候选不同，故界面保留全部 IPA 候选且不声称逐音素一致。
- 测试：全项目 124 项通过，1 条上游 TestClient 弃用警告不阻塞。
