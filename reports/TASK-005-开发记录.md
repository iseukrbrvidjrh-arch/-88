# TASK-005 开发记录

- 状态：2026-10-30 自主验收通过。
- 核心功能：候选词分页、显式单词加入、大小写/弯撇号去重、并发唯一、多语境幂等、学习库查询与词条详情、来源 cue 定位。
- 数据迁移：V4 新增 `learning_item`、`context_ref`、`review_state`；迁移前备份验证通过。
- 接口：`GET /api/v1/subtitles/{id}/candidates`、`POST/GET /api/v1/vocabulary`、`GET /api/v1/vocabulary/{id}`。
- 测试：全项目 84 项通过；真实 V3→V4 迁移、加词和重启持久化通过。
- 修复：阻止不在指定 cue 中的词形被关联；修复多语境导致词次排序重复累计的风险；来源定位按 cue 所在页打开。
- 遗留风险：暂无释义/IPA/复习历史（按任务边界明确占位）；浏览器自动化宿主不可用；上游 TestClient 有 1 条弃用警告。
