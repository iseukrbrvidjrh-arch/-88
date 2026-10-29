# TASK-002 开发与测试记录

| 项目 | 结果 |
| --- | --- |
| 任务 | 本地存储骨架、数据库迁移与事务管理 |
| 状态 | 已完成（2026-10-30，自主验收通过）；未提交或推送 |
| 依据 | `tasks/TASK-002.md`、SRS V0.2、已批准系统架构、数据库逻辑模型 §11 |
| 自动化测试 | `40 passed, 1 warning`（FastAPI/Starlette TestClient 的上游弃用提示） |

## 文件与职责

- `app/core/config.py`：增加 `SCENELINGO_DB_PATH` / `--db-path` 对应配置；相对数据库路径以数据目录为基准。
- `app/repositories/database.py`：私有 SQLite 文件、每次连接的外键/WAL/忙等待设置、连接关闭、自检和显式事务。
- `app/repositories/migrations/versions.py`：有序迁移定义；当前 V1 仅建立版本基线，**不创建业务表**。
- `app/repositories/migrations/runner.py`：迁移计划校验、WAL 检查点、SQLite 在线备份、单事务迁移与备份保留。
- `app/repositories/base.py`、`app/api/dependencies.py`：后续仓储和请求级连接作用域的最小入口；同步路由在自己的线程内进入作用域并关闭连接，本任务未新增业务路由。
- `app/main.py`、`app/core/logging.py`：启动前初始化，成功才开放 HTTP；记录版本与迁移结果，失败时给出恢复说明并停止启动。
- `.gitignore`：补充 `backups/`、SQLite journal 与临时备份文件；原有 `*.db`、WAL/SHM 规则继续有效。
- `tests/test_task002.py`：迁移、备份、外键、事务、锁、权限、配置与 Git 忽略规则测试。
- `tests/test_task001.py`：令牌落盘检查改为按字节读取，以兼容新增的二进制 SQLite 文件；原测试语义不变。

## 初始化、迁移与备份

启动顺序：验证数据目录与数据库文件权限 → 打开现有库（不存在时仅创建一次）→ 每次连接启用外键、WAL 和 5,000 毫秒忙等待 → `SELECT 1`、完整性及 `user_version` 自检 → 若版本落后，先做 WAL 检查点与 SQLite 在线备份 → 在**一个事务**内依次执行待迁移版本并更新 `user_version` → 成功后才开放接口。

生产迁移当前只有 **V1**。它是机制基线；数据库中没有业务表、没有额外迁移版本表。测试中创建的父子表、锁测试表及失败注入表只存在于临时测试库，不进入生产迁移。已是 V1 时不执行迁移，也不创建新备份。数据库版本高于程序支持版本时拒绝降级。

默认库位置：`~/Library/Application Support/SceneLingo/scenelingo.db`；备份在其同级 `backups/`。`--db-path` 或 `SCENELINGO_DB_PATH` 可指定本地路径；自定义路径的父目录必须为 `0700`，库文件为 `0600`。备份文件名含 UTC 时间戳与迁移前版本，只保留最新一份**由本应用命名的**迁移前备份；其他文件不清理。

## 实际验证

```text
pytest -q: 40 passed, 1 warning in 0.43s
首次真实启动：127.0.0.1:18767，health HTTP 200
测试库：版本 1，业务表 0，权限 0600；数据目录 0700
迁移前备份：1 份，版本 0，权限 0600
重复启动：版本仍为 1，备份仍为 1；日志 code=already_current
只读库：启动退出码 2、未开放服务、原库仍为版本 1
恢复 0600 权限后：可再次正常启动与停止
```

自动化测试还验证了：外键拒绝孤立行；异常回滚数据和测试表；多个待迁移版本按序且共同回滚；备份后若另一启动过程改变数据库版本则停止本次迁移；失败迁移保留原库和可打开的迁移前备份；第二写者在短超时后得到可分类的占用错误；备份失败不执行迁移；数据库与备份路径均被 Git 忽略。TASK-001 的 24 项测试继续通过。日志只记录版本号、结果和错误码，不记录数据内容或数据库路径。

## 运行与故障恢复

正常启动（默认库位置）：

```bash
cd ~/Desktop/SceneLingo
.venv/bin/python -m app.main --port 18767
```

隔离测试或自定义本地库路径：

```bash
.venv/bin/python -m app.main --port 18767 --data-dir /private/tmp/scenelingo-task002-check --db-path alternate.db
```

如迁移失败，先停止服务并保留原库。查看 `backups/` 中最新的 `scenelingo-before-v*.db`，先修复权限、磁盘空间或迁移代码，再重试启动；**程序不会自动删除、重建或降级主库**。确需人工恢复备份时，先确认服务已停止、选对数据库目录和备份版本，再执行以下步骤（自定义 `--db-path` 时将 `DB_DIR` 改为该库的父目录）：

```bash
DB_DIR="$HOME/Library/Application Support/SceneLingo"
BACKUP="$DB_DIR/backups/<选定的备份文件名>.db"
RECOVERY_DIR="$DB_DIR/recovery-YYYYMMDD-HHMMSS"
mkdir -m 700 "$RECOVERY_DIR"
mv "$DB_DIR/scenelingo.db" "$RECOVERY_DIR/"
# 如果存在 scenelingo.db-wal 或 scenelingo.db-shm，也分别移动到 RECOVERY_DIR；不要删除。
cp "$BACKUP" "$DB_DIR/scenelingo.db"
chmod 600 "$DB_DIR/scenelingo.db"
```

以上恢复步骤保留原库与 WAL/SHM 文件，避免直接覆盖。恢复前请由用户确认备份版本与数据取舍；恢复后启动并检查日志中的版本与健康接口。自动恢复/导出界面不属于 TASK-002。

## 已知限制与下一步

- 当前没有业务表，无法验证字幕、词条等业务持久化；这些属于后续批准的任务。
- 并发写在超过忙等待时间后返回占用错误，调用方需提示重试；不会静默丢写。
- 启动完整性检查随数据库规模增加可能耗时，待真实数据规模下观察。
- 上游 TestClient 弃用警告仍存在；未引入新依赖。
- 本任务未修改 SRS、系统架构或数据库逻辑模型，也未执行 TASK-003。

## 自主验收结论

代码、任务卡、异常路径、数据库权限与测试覆盖复核通过。审查期间修复了同步路由连接的线程边界，并增加备份后版本竞争、高版本拒绝、备份失败和整组迁移回滚测试。最终为 **40 passed，1 warning**；按项目自主开发规则进入 TASK-003。
