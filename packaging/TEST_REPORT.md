# SceneLingo V0.3 应用交付验收

日期：2026-11-01 · macOS 26.5.1 · Apple Silicon arm64

## 已验证

- 构建脚本生成 `dist/SceneLingo.app`，版本 0.3.0；应用包 ad-hoc 签名完整性校验通过。
- 包内 Python、FastAPI、Uvicorn、SQLite 模块可导入；前端、IPA/TTS、Keychain、千问网关、迁移等项目资源随包包含。
- 主页真实读取进度、学习记录和最近导入字幕；学习工作台继续使用正式 IPA、TTS、学习库、复习、AI 预览/确认与会话历史接口。每日问候只用本地时间和内置文案，不发起网络请求。
- 前端 JavaScript 语法、页面 ID 合同、本地日期问候时段和相邻日期文案变更检查通过；`git diff --check` 通过。
- 自动化测试：175 passed，1 条 Starlette 测试客户端弃用警告。
- 正式用户数据库未被测试写入；网络 API 与千问没有被调用。

## 尚未通过实际GUI验收

- 当前执行环境的 Chrome 浏览器自动化宿主不可用；本地 Python 服务也被运行沙箱拒绝监听 `127.0.0.1`。
- 从终端直接执行 AppKit 主程序会因未通过 macOS LaunchServices 注册而退出。这不等同于 Finder 双击结果；因此本轮没有声称双击、浏览器流程、端口冲突、重复启动或退出的 GUI 验收通过。
- 原有自动化测试覆盖业务API；本轮没有以隔离数据库完成完整 SRT→IPA/TTS→复习→聊天→重启的端到端界面测试。

## 交付限制

- 个人签名应用，未使用开发者证书或公证；首次打开如被 Gatekeeper 拦截，请在 Finder 右键应用并选择“打开”。
- 构建产物仅支持 Apple Silicon；最终运行时内置 Python，不要求另装 Python。
- 双击实际启动验收仍需在 Finder 中完成。退出方式为 SceneLingo 菜单或状态窗口里的“退出 SceneLingo”；关闭浏览器标签不会停止服务。
