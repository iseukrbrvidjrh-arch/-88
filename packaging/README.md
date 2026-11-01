# SceneLingo macOS 打包与使用

## 使用

- 双击 `dist/SceneLingo.app`。应用会启动仅监听 `127.0.0.1` 的本地服务，然后打开默认浏览器。
- 退出时从 Dock 中右键 SceneLingo 选择“退出”，或在 SceneLingo 菜单中选择“退出 SceneLingo”。只关闭浏览器标签页不会停止后台服务。
- 学习数据继续保存在 `~/Library/Application Support/SceneLingo/`，更换 `.app` 不会覆盖它。
- 千问 Key 从应用的“设置”页保存到 macOS Keychain。未经预览和二次确认不会发送。

## 首次打开与 Gatekeeper

此个人版未使用 Apple 开发者证书，也未公证。若 macOS 拦截，请在 Finder 中右键 `SceneLingo.app` →“打开”→再确认“打开”。不需要关闭 Gatekeeper、SIP 或输入管理员密码。

## 备份和更新

- 完全退出 SceneLingo 后，备份 `~/Library/Application Support/SceneLingo/`。
- 更新时只替换 `SceneLingo.app`，不要删除 Application Support 中的数据。
- 数据库迁移仍使用 SceneLingo 原有的迁移前备份机制。

## 重新构建

```bash
cd /Users/dang/Desktop/SceneLingo
./packaging/build_app.sh
```

构建依赖当前项目的 Python 3.14 Homebrew 运行时和 `.venv`；最终用户运行 `.app` 时不需要 Python。构建产物为 Apple Silicon 版。
