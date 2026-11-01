# SceneLingo.app 打包验收报告

日期：2026-11-01
环境：macOS 26.5.1，Apple Silicon arm64

## 已实际验证

- 在 Finder 中双击 `dist/SceneLingo.app`，无终端窗口，状态窗口和 Chrome 学习页面正常打开。
- 8765 被未知 Node 服务占用时，没有终止它，SceneLingo 安全选择 18765。
- 重复双击只保留一个 SceneLingo 服务。
- 状态窗口“退出 SceneLingo”会正常停止本应用启动的服务；退出后监听端口消失。
- 使用隔离数据完成：原创 SRT 导入、字幕阅读、IPA、单词与句子 TTS、保存单词、拼写复习、学习记录、创建 AI 会话、Keychain 配置状态。
- 没有进行真实千问 API 调用。
- 退出后重启，字幕 1、生词 1、复习记录 1、AI 会话 1 全部恢复，SQLite `integrity_check=ok`。

## 自动化与构建验证

- Pytest：175 passed，0 failed（1 个第三方库弃用警告）。
- 包内 Python/FastAPI/Uvicorn/SQLite/OpenSSL 导入通过。
- 包内 Mach-O 依赖审计通过：无 `.venv`、项目路径或 Homebrew 运行时依赖。
- HTML、CSS、JavaScript、IPA 词典和数据库迁移文件均在应用包内。
- ad-hoc 签名完整性验证通过。

## 尚未实际验证

- 没有关闭 macOS 全局网络，避免影响用户其他应用。本地离线路径由现有自动化测试和本地接口分层验证。
- 未发起真实千问请求；发送预览、同意开关和 Keychain 访问路径已验证。

## 已知限制

- 应用为 Apple Silicon arm64 构建。
- 未使用 Apple 开发者证书，未公证；换机或下载后可能需要通过 Finder 右键“打开”完成首次启动。
- 关闭浏览器标签页不等于退出应用，应使用 SceneLingo 状态窗口或应用菜单退出。
