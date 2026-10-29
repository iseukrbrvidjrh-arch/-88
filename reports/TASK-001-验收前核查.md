# TASK-001 验收前核查记录

日期：2026-10-29。范围：本地应用基础骨架、健康检查与安全监听；未执行后续任务。

## 端口与启动

- 配置默认端口为 **8765**；未设置 `SCENELINGO_PORT` 或 `--port` 时使用该值。
- 配置优先级：`--port` > `SCENELINGO_PORT` > 默认值。测试客户端使用同一个默认端口常量。
- 本机验收时 `8765` 已被其他进程占用。因此真实启动明确使用 `--port 18765`；这不会改变应用默认值。
- 监听地址在代码中固定为 `127.0.0.1`，没有对外监听的配置项。

首次准备：

```bash
cd ~/Desktop/SceneLingo
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

默认端口空闲时启动：

```bash
.venv/bin/python -m app.main
```

当前机器的验收启动：

```bash
.venv/bin/python -m app.main --port 18765
```

启动后，浏览器访问与 `curl` 命令必须使用**同一端口**。例如验收端口：

```bash
curl http://127.0.0.1:18765/api/v1/health
.venv/bin/python -m pytest -q
```

在运行服务的终端按 `Ctrl+C` 停止。

## 核查结果

| 项目 | 实际结果 |
| --- | --- |
| 自动化测试 | `24 passed, 1 warning`；警告来自 FastAPI/Starlette TestClient 对 `httpx` 的弃用提示 |
| 真实启动 | Uvicorn 显示 `http://127.0.0.1:18765`；`lsof` 仅显示该回环地址监听 |
| Chrome 首页 | 刷新后显示“本地服务正常运行 · 版本 0.1.0” |
| 健康检查 | `200`，仅返回 `status`、`version`、`time` |
| 受保护 API | 页面动态获得进程令牌并通过请求头调用：有令牌 `200`，无令牌 `401` |
| 令牌与日志 | 令牌不在静态 HTML/JS 源文件、URL 或日志中；启动时生成，重启后更换 |
| 本地边界 | 无 CORS 放行头；连接 `127.0.0.2:18765` 失败；页面代码不引用外部 URL |
| 忽略规则 | `.venv/`、缓存、日志、`*.token` 和 `.tokens/` 均由 `.gitignore` 过滤 |
| 停止 | `Ctrl+C` 后进程正常退出，`18765` 不再监听 |

**仍待用户人工验收：**从同一局域网的另一台设备访问本机局域网 IP，应连接失败。本次已验证回环绑定，但没有代替另一台设备进行实际连接测试。

## 令牌与浏览器边界安全审查

首页处理函数从磁盘读取仅含占位符的 `app/web/index.html`，将本次进程生成的随机令牌放入**动态响应**的 `<meta name="scenelingo-token">`。本地 `app.js` 从该元素读取令牌，只在 `X-SceneLingo-Token` 请求头中发送给受保护 API。令牌不写入静态文件、URL、日志或数据目录。动态首页响应本身含令牌，并设置 `Cache-Control: no-store`；这是前端取得令牌的设计途径。

| 攻击或边界 | 检查结果 |
| --- | --- |
| 异常 Host / DNS 重绑定入口 | 非 `127.0.0.1`、`localhost` 及当前端口的 Host 返回 `403`；Uvicorn 仅绑定 `127.0.0.1` |
| 外站或 `null` Origin | 请求返回 `403`，包括带正确令牌的请求 |
| 无 Origin 的写请求 | `POST`、`PUT`、`PATCH`、`DELETE` 均返回 `403`；浏览器顶层导航的无 Origin `GET /` 可得到页面，但跨源脚本不能读取其响应 |
| 跨站表单与 Content-Type | 写请求要求同源 Origin、令牌和 `application/json`；表单编码、`multipart/form-data`、`text/plain` 返回 `415`（在其余条件满足时） |
| 浏览器预检 | 外站 `OPTIONS` 返回 `403`；同源但无令牌的 `OPTIONS` 返回 `401`；均不发送 CORS 放行头 |
| Chrome 跨源读取实测 | 从 `127.0.0.1:18766` 页面 `fetch` `127.0.0.1:18765` 首页和受保护 API，均显示“blocked by browser” |
| 页面脚本与嵌入 | CSP 仅允许同源脚本，禁止内联脚本及跨站嵌入；`nosniff`、`no-referrer`、`no-store` 均已设置 |

**残余风险：**同一台电脑上的其他进程可像浏览器一样请求首页、读取动态响应里的令牌，再以请求头访问 API。自动化测试已演示这点。已批准架构 §9.2 明确本地进程不属于该令牌机制的信任边界；本任务不引入账户、操作系统级进程身份验证或复杂凭据系统。已控制本应用同源页面或可读取其 DOM 的恶意浏览器扩展也可取得令牌，需依赖本机和浏览器自身的安全管理。另一台局域网设备的实际连接测试仍待用户完成。
