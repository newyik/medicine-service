import Cocoa
import WebKit

let siteURL = URL(string: "https://newyik.github.io/medicine-service/")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate, NSToolbarDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var downloads: [WKDownload] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        makeMenu()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        installAppearance(in: configuration.userContentController)
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "吃药服务"
        window.minSize = NSSize(width: 400, height: 580)
        window.isReleasedWhenClosed = false
        window.contentView = web
        window.delegate = self
        window.toolbarStyle = .unifiedCompact
        let toolbar = NSToolbar(identifier: "MedicineToolbar")
        toolbar.delegate = self
        toolbar.allowsUserCustomization = true
        toolbar.autosavesConfiguration = true
        window.toolbar = toolbar
        window.center()
        window.setFrameAutosaveName("MedicineMainWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: siteURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
    }
    private func installAppearance(in controller: WKUserContentController) {
        guard let url = Bundle.main.url(forResource: "Appearance", withExtension: "css"),
              let css = try? String(contentsOf: url, encoding: .utf8),
              let payload = try? JSONSerialization.data(withJSONObject: [css]),
              let literal = String(data: payload, encoding: .utf8) else { return }
        let source = """
        if (location.origin === '\(siteURL.scheme!)://\(siteURL.host!)' && location.href.split(/[?#]/)[0] === '\(siteURL.absoluteString)') {
            const appearance = document.createElement('style');
            appearance.id = 'medicine-mac-appearance';
            appearance.textContent = \(literal)[0];
            document.head.append(appearance);
        }
        """
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    func makeMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于吃药服务", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏吃药服务", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出吃药服务", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let editItem = NSMenuItem(); let edit = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key) }
        editItem.submenu = edit; menu.addItem(editItem)
        let viewItem = NSMenuItem(); let view = NSMenu(title: "显示")
        view.addItem(withTitle: "刷新／获取最新版本", action: #selector(refresh), keyEquivalent: "r")
        view.addItem(withTitle: "返回", action: #selector(goBack), keyEquivalent: "[")
        view.addItem(withTitle: "在浏览器中打开", action: #selector(openBrowser), keyEquivalent: "")
        view.addItem(.separator())
        view.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(withTitle: "实际大小", action: #selector(zoomReset), keyEquivalent: "0")
        viewItem.submenu = view; menu.addItem(viewItem)
        let recordItem = NSMenuItem(); let record = NSMenu(title: "记录")
        addCommand("补记用药", #selector(addDose), "n", to: record)
        addCommand("记录就诊", #selector(addVisit), "j", to: record)
        addCommand("用药记录", #selector(showJournal), "1", to: record)
        addCommand("看病记录", #selector(showVisits), "2", to: record)
        addCommand("同步云端记录", #selector(syncJournal), "s", to: record)
        recordItem.submenu = record; menu.addItem(recordItem)
        let windowItem = NSMenuItem(); let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu; menu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = menu
    }
    @objc func about() {
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "吃药服务", .applicationVersion: "2.1", .credits: NSAttributedString(string: "与线上网页使用同一界面和云端数据。\n使用「记录」菜单或窗口工具栏快速操作。")])
    }
    @objc func refresh() {
        web.evaluateJavaScript("!!document.querySelector('dialog[open]') || !!document.querySelector('#email-login-password')?.value") { [weak self] result, _ in
            guard let self = self else { return }
            if result as? Bool == true {
                let alert = NSAlert(); alert.messageText = "刷新会关闭当前输入"; alert.informativeText = "请先保存正在编辑的内容。未保存的输入可能丢失。"; alert.addButton(withTitle: "继续编辑"); alert.addButton(withTitle: "仍然刷新")
                alert.beginSheetModal(for: self.window) { if $0 == .alertSecondButtonReturn { self.web.reloadFromOrigin() } }
            } else { self.web.reloadFromOrigin() }
        }
    }
    @objc func goBack() { if web.canGoBack { web.goBack() } }
    @objc func openBrowser() { NSWorkspace.shared.open(web.url ?? siteURL) }
    @objc func zoomIn() { web.pageZoom = min(2, web.pageZoom + 0.1) }
    @objc func zoomOut() { web.pageZoom = max(0.7, web.pageZoom - 0.1) }
    @objc func zoomReset() { web.pageZoom = 1 }
    private func addCommand(_ title: String, _ action: Selector, _ key: String, to menu: NSMenu) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = self
    }

    private var tools: [(String, String, String, Selector)] {
        [
            ("journal", "用药记录", "pills", #selector(showJournal)),
            ("visits", "看病记录", "cross.case", #selector(showVisits)),
            ("dose", "补记用药", "plus", #selector(addDose)),
            ("sync", "同步", "arrow.clockwise", #selector(syncJournal))
        ]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        tools.map { NSToolbarItem.Identifier($0.0) } + [.flexibleSpace, .space]
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.init("journal"), .init("visits"), .flexibleSpace, .init("dose"), .init("sync")]
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard let tool = tools.first(where: { $0.0 == identifier.rawValue }) else { return nil }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = tool.1
        item.paletteLabel = tool.1
        item.toolTip = tool.1
        item.image = NSImage(systemSymbolName: tool.2, accessibilityDescription: tool.1)
        item.target = self
        item.action = tool.3
        return item
    }

    @objc private func showJournal() { runPageAction(route: "") }
    @objc private func showVisits() { runPageAction(route: "#visits") }
    @objc private func addDose() { runPageAction(route: "", button: "manual") }
    @objc private func addVisit() { runPageAction(route: "#visits", button: "visit-add") }
    @objc private func syncJournal() { runPageAction(button: "sync-retry") }

    private func runPageAction(route: String? = nil, button: String? = nil) {
        guard let url = web.url, url.scheme == siteURL.scheme, url.host == siteURL.host,
              url.path == siteURL.path, !web.isLoading, window.attachedSheet == nil else { return }
        let script = """
        if (document.getElementById('app-main')?.hidden || document.querySelector('dialog[open]')) return false;
        const journal = document.getElementById('journal');
        const visits = document.getElementById('visits-page');
        if (!journal || !visits || (journal.hidden && visits.hidden)) return false;
        const control = button ? document.getElementById(button) : null;
        if (button && (!control || control.disabled)) return false;
        if (route !== null && location.hash !== route) {
            await new Promise(resolve => {
                window.addEventListener('hashchange', resolve, {once:true});
                location.hash = route;
            });
        }
        if (document.querySelector('dialog[open]')) return false;
        control?.click();
        return true;
        """
        web.callAsyncJavaScript(script, arguments: ["route": route as Any? ?? NSNull(), "button": button as Any? ?? NSNull()],
                                in: nil, in: .page) { result in
            if case .success(let handled) = result, handled as? Bool == true { return }
            NSSound.beep()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        return true
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    func showError(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        let alert = NSAlert(); alert.messageText = "暂时无法连接吃药服务"; alert.informativeText = "请检查网络后按 ⌘R 重试。云端已经保存的记录不会丢失。\n" + error.localizedDescription; alert.addButton(withTitle: "知道了")
        if window.attachedSheet == nil { alert.beginSheetModal(for: window) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showError(NSError(domain: "吃药服务", code: 1, userInfo: [NSLocalizedDescriptionKey: "页面进程已退出，请按 ⌘R 重新载入。未提交的输入可能需要重填。 "])) }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        if ["https", "http", "about", "blob", "data"].contains(url.scheme ?? "") { decisionHandler(.allow) }
        else { decisionHandler(.cancel); NSWorkspace.shared.open(url) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) { decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download) }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { downloads.append(download); download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { downloads.append(download); download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = suggestedFilename; panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func downloadDidFinish(_ download: WKDownload) { downloads.removeAll { $0 === download } }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { downloads.removeAll { $0 === download }; if (error as NSError).code != NSURLErrorCancelled { showError(error) } }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }; return nil }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "确定"); a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "确定"); a.addButton(withTitle: "取消"); a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a=NSAlert(); a.messageText=prompt; let field=NSTextField(string:defaultText ?? ""); field.frame=NSRect(x:0,y:0,width:300,height:24); a.accessoryView=field; a.addButton(withTitle:"确定");a.addButton(withTitle:"取消");a.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn ? field.stringValue:nil)}
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p=NSOpenPanel(); p.allowsMultipleSelection=parameters.allowsMultipleSelection;p.canChooseDirectories=parameters.allowsDirectories;p.beginSheetModal(for:window){completionHandler($0 == .OK ? p.urls:nil)}
    }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
