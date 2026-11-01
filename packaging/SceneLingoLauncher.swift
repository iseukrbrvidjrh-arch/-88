import AppKit
import Darwin
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: Process?
    private var activeURL: URL?
    private var ownsServer = false
    private var statusWindow: NSWindow?
    private let candidatePorts = [8765, 18765] + Array(18766...18775)

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()
        NSApp.setActivationPolicy(.regular)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.startOrReconnect() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        statusWindow?.makeKeyAndOrderFront(nil)
        if let url = activeURL { NSWorkspace.shared.open(url) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        guard ownsServer, let process = server, process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(3)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }

    private func installMenu() {
        let main = NSMenu()
        let applicationItem = NSMenuItem()
        main.addItem(applicationItem)
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "打开 SceneLingo", action: #selector(openLearningPage), keyEquivalent: "o")
        applicationMenu.addItem(NSMenuItem.separator())
        applicationMenu.addItem(withTitle: "退出 SceneLingo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu
        NSApp.mainMenu = main
    }

    @objc private func openLearningPage() {
        if let url = activeURL { NSWorkspace.shared.open(url) }
    }

    @objc private func quitApp() { NSApp.terminate(nil) }

    private func startOrReconnect() {
        for port in candidatePorts where isSceneLingo(port: port) {
            finishStartup(port: port, ownsProcess: false)
            return
        }
        guard let port = candidatePorts.first(where: { isPortFree($0) }) else {
            fail("无法启动：候选本地端口均已被占用。\nSceneLingo 未终止任何其他程序。")
            return
        }
        do {
            try launchServer(port: port)
        } catch {
            fail("无法启动 SceneLingo 本地服务：\n\(error.localizedDescription)")
            return
        }
        for _ in 0..<100 {
            if isSceneLingo(port: port) { finishStartup(port: port, ownsProcess: true); return }
            if server?.isRunning == false { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        server?.terminate()
        fail("本地服务未能就绪。\n请查看 ~/Library/Application Support/SceneLingo/logs/launcher-app.log")
    }

    private func launchServer(port: Int) throws {
        guard let resources = Bundle.main.resourceURL,
              let executable = Bundle.main.executableURL?.deletingLastPathComponent().appendingPathComponent("python3.14") else {
            throw NSError(domain: "SceneLingo", code: 1, userInfo: [NSLocalizedDescriptionKey: "应用资源不完整。"])
        }
        let inheritedDataDirectory = ProcessInfo.processInfo.environment["SCENELINGO_DATA_DIR"].map {
            URL(fileURLWithPath: $0, isDirectory: true)
        }
        let dataDirectory = inheritedDataDirectory ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SceneLingo", isDirectory: true)
        let logs = dataDirectory.appendingPathComponent("logs", isDirectory: true)
        try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let logURL = logs.appendingPathComponent("launcher-app.log")
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        let log = try FileHandle(forWritingTo: logURL); try log.seekToEnd()

        let process = Process()
        process.executableURL = executable
        process.arguments = ["-m", "app.main", "--port", String(port)]
        process.currentDirectoryURL = resources.appendingPathComponent("project", isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        let pythonHome = Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/Python.framework/Versions/3.14").path
        environment["PYTHONHOME"] = pythonHome
        environment["PYTHONPATH"] = [resources.appendingPathComponent("site-packages").path,
                                      resources.appendingPathComponent("project").path].joined(separator: ":")
        environment["PYTHONNOUSERSITE"] = "1"
        environment["SCENELINGO_PORT"] = String(port)
        process.environment = environment
        process.standardOutput = log
        process.standardError = log
        try process.run()
        server = process
        ownsServer = true
    }

    private func finishStartup(port: Int, ownsProcess: Bool) {
        ownsServer = ownsProcess
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        activeURL = url
        DispatchQueue.main.async {
            self.showStatusWindow(port: port)
            NSWorkspace.shared.open(url)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func showStatusWindow(port: Int) {
        if statusWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 190),
                                  styleMask: [.titled, .closable, .miniaturizable],
                                  backing: .buffered, defer: false)
            window.title = "SceneLingo"
            window.isReleasedWhenClosed = false
            let title = NSTextField(labelWithString: "SceneLingo 正在运行")
            title.font = .boldSystemFont(ofSize: 20)
            title.alignment = .center
            let detail = NSTextField(labelWithString: "")
            detail.tag = 100
            detail.textColor = .secondaryLabelColor
            detail.alignment = .center
            let open = NSButton(title: "打开学习页面", target: self, action: #selector(openLearningPage))
            open.bezelStyle = .rounded
            let quit = NSButton(title: "退出 SceneLingo", target: self, action: #selector(quitApp))
            quit.bezelStyle = .rounded
            let buttons = NSStackView(views: [open, quit])
            buttons.orientation = .horizontal; buttons.spacing = 12; buttons.alignment = .centerY
            let stack = NSStackView(views: [title, detail, buttons])
            stack.orientation = .vertical; stack.spacing = 18; stack.alignment = .centerX
            stack.translatesAutoresizingMaskIntoConstraints = false
            window.contentView?.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor),
                stack.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor),
                stack.leadingAnchor.constraint(greaterThanOrEqualTo: window.contentView!.leadingAnchor, constant: 20),
                stack.trailingAnchor.constraint(lessThanOrEqualTo: window.contentView!.trailingAnchor, constant: -20)
            ])
            statusWindow = window
        }
        if let detail = statusWindow?.contentView?.viewWithTag(100) as? NSTextField {
            detail.stringValue = "本地服务：127.0.0.1:\(port)\n关闭浏览器标签页不会退出应用。"
        }
        statusWindow?.center()
        statusWindow?.makeKeyAndOrderFront(nil)
    }

    private func isSceneLingo(port: Int) -> Bool {
        guard let healthURL = URL(string: "http://127.0.0.1:\(port)/api/v1/health"),
              let rootURL = URL(string: "http://127.0.0.1:\(port)/"),
              let health = try? Data(contentsOf: healthURL, options: .uncached),
              let object = try? JSONSerialization.jsonObject(with: health) as? [String: Any],
              object["status"] as? String == "ok",
              let page = try? String(contentsOf: rootURL, encoding: .utf8) else { return false }
        return page.contains("name=\"scenelingo-token\"") && page.contains("SceneLingo")
    }

    private func isPortFree(_ port: Int) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "SceneLingo 启动失败"
            alert.informativeText = message
            alert.alertStyle = .critical
            alert.addButton(withTitle: "退出")
            alert.runModal()
            NSApp.terminate(nil)
        }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
