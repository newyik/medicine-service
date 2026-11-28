// 吃药服务 Mac 外壳（WebWrap）
// 业务逻辑全部在网页里，这里只负责“像一个 Mac 应用”：
// 原生工具栏（用药/看病切换、新建菜单、刷新）、完整菜单栏和快捷键、跟随系统深浅色、
// 记住窗口大小位置、网页里的确认框、导入备份时的选文件、导出备份时的保存位置。
// 网址和名称来自 App 包内的 Contents/Resources/config.json。
// 旧版（SwiftUI 简单外壳）备份在 main.swift.bak-20261117。

import AppKit
import WebKit
import UniformTypeIdentifiers

// MARK: - 配置

struct Config {
    let url: URL
    let title: String
    static let shared: Config = {
        let fallback = Config(url: URL(string: "about:blank")!, title: "网页应用")
        guard let p = Bundle.main.url(forResource: "config", withExtension: "json"),
              let d = try? Data(contentsOf: p),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: String],
              let u = o["url"].flatMap(URL.init(string:)) else { return fallback }
        return Config(url: u, title: o["title"] ?? "网页应用")
    }()
}

// MARK: - 注入网页的脚本

/// 给网页加上 native-mac 标记（网页样式据此隐藏与工具栏重复的顶栏），
/// 并在登录状态或页面切换时通知外壳更新工具栏。
private let bridgeEarly = "document.documentElement.classList.add('native-mac');"
private let bridgeLate = """
(function(){
  const post=()=>{try{webkit.messageHandlers.shell.postMessage({
    signedIn:!document.body.classList.contains('signed-out'),
    page:['visits','checkups'].indexOf(location.hash.slice(1))+1})}catch(e){}};
  new MutationObserver(post).observe(document.body,{attributes:true,attributeFilter:['class']});
  addEventListener('hashchange',post); post();
})();
"""

/// 切到某个页面，再点网页里的某个按钮（按钮 id 见 medicine-service/index.html）
/// 0 用药、1 看病、2 体检，对应网页地址里的 #… 
let pageHashes = ["", "visits", "checkups"]
let pageTitles = ["用药记录", "看病记录", "体检报告"]
private func clickScript(page: Int?, id: String?) -> String {
    var js = "(function(){"
    if let p = page { js += "const want='\(pageHashes[p])';if(location.hash.slice(1)!==want){location.hash=want;}" }
    if let id { js += "setTimeout(()=>{const b=document.getElementById('\(id)');if(b&&!b.closest('[hidden]'))b.click();},80);" }
    js += "})();"
    return js
}

// MARK: - 窗口控制器

final class MainWindowController: NSWindowController, NSToolbarDelegate, NSMenuItemValidation,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {

    let webView: WKWebView
    private let segmented = NSSegmentedControl(labels: ["用药", "看病", "体检"], trackingMode: .selectOne, target: nil, action: nil)
    private let spinner = NSProgressIndicator()
    private let errorView = NSStackView()
    private var signedIn = false
    private var firstLoadDone = false
    private var leftAt: Date?
    /// 离开超过这么久再回来才自动刷新，免得冲掉正在填的内容
    private let staleAfter: TimeInterval = 600

    init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: bridgeEarly, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: bridgeLate, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        cfg.userContentController = ucc
        cfg.applicationNameForUserAgent = "MedicineMac/3"
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = Config.shared.title
        window.minSize = NSSize(width: 420, height: 520)
        window.toolbarStyle = .unified
        window.backgroundColor = .windowBackgroundColor
        window.isReleasedWhenClosed = false
        super.init(window: window)

        ucc.add(WeakMessageHandler(self), name: "shell")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        buildContent()
        buildToolbar()
        window.center()
        window.setFrameAutosaveName("MainWindow")
        webView.load(URLRequest(url: Config.shared.url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20))
    }
    required init?(coder: NSCoder) { fatalError() }

    // 内容区：网页 + 首次加载转圈 + 断网提示
    private func buildContent() {
        let root = NSView()
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)

        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimation(nil)
        root.addSubview(spinner)

        let icon = NSImageView(image: NSImage(systemSymbolName: "wifi.exclamationmark", accessibilityDescription: nil) ?? NSImage())
        icon.symbolConfiguration = .init(pointSize: 34, weight: .regular)
        icon.contentTintColor = .secondaryLabelColor
        let title = NSTextField(labelWithString: "暂时连不上")
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        let detail = NSTextField(labelWithString: "请检查网络连接，然后重试。")
        detail.textColor = .secondaryLabelColor
        let retry = NSButton(title: "重试", target: self, action: #selector(reloadPage(_:)))
        retry.bezelStyle = .rounded
        retry.keyEquivalent = "\r"
        errorView.orientation = .vertical
        errorView.spacing = 10
        errorView.setViews([icon, title, detail, retry], in: .center)
        errorView.setCustomSpacing(16, after: detail)
        errorView.translatesAutoresizingMaskIntoConstraints = false
        errorView.isHidden = true
        root.addSubview(errorView)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            errorView.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            errorView.centerYAnchor.constraint(equalTo: root.centerYAnchor),
        ])
        window?.contentView = root
    }

    // MARK: 工具栏

    private enum Item {
        static let switcher = NSToolbarItem.Identifier("switcher")
        static let add = NSToolbarItem.Identifier("add")
        static let reload = NSToolbarItem.Identifier("reload")
    }

    private func buildToolbar() {
        let tb = NSToolbar(identifier: "main")
        tb.delegate = self
        tb.displayMode = .iconOnly
        tb.allowsUserCustomization = false
        tb.centeredItemIdentifiers = [Item.switcher]
        segmented.target = self
        segmented.action = #selector(switchPage(_:))
        segmented.selectedSegment = 0
        segmented.setWidth(64, forSegment: 0)
        segmented.setWidth(64, forSegment: 1)
        segmented.setWidth(64, forSegment: 2)
        window?.toolbar = tb
        updateChrome()
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, Item.switcher, .flexibleSpace, Item.reload, Item.add]
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        switch id {
        case Item.switcher:
            let item = NSToolbarItem(itemIdentifier: id)
            item.view = segmented
            item.label = "页面"
            item.toolTip = "切换用药、看病、体检（⌘1 / ⌘2 / ⌘3）"
            return item
        case Item.reload:
            let item = NSToolbarItem(itemIdentifier: id)
            item.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "重新载入")
            item.label = "重新载入"
            item.toolTip = "重新载入（⌘R）"
            item.isBordered = true
            item.target = self
            item.action = #selector(reloadPage(_:))
            return item
        case Item.add:
            let item = NSMenuToolbarItem(itemIdentifier: id)
            item.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "新建")
            item.label = "新建"
            item.toolTip = "新建记录"
            item.showsIndicator = true
            item.menu = AppMenus.newItemsMenu()
            return item
        default:
            return nil
        }
    }

    /// 登录前隐藏切换和新建；登录后网页自己的顶栏隐藏，由工具栏代替
    private func updateChrome() {
        for item in window?.toolbar?.items ?? [] where item.itemIdentifier == Item.switcher || item.itemIdentifier == Item.add {
            if #available(macOS 15.0, *) { item.isHidden = !signedIn } else { item.isEnabled = signedIn }
        }
        segmented.isEnabled = signedIn
        window?.subtitle = signedIn ? pageTitles[max(0, segmented.selectedSegment)] : ""
    }

    // MARK: 动作（菜单和工具栏共用）

    @objc func switchPage(_ sender: Any?) {
        var page = 0
        if let s = sender as? NSSegmentedControl { page = s.selectedSegment }
        else if let m = sender as? NSMenuItem { page = m.tag }
        page = min(max(page, 0), 2)
        segmented.selectedSegment = page
        run(clickScript(page: page, id: nil))
        updateChrome()
    }
    @objc func reloadPage(_ sender: Any?) {
        errorView.isHidden = true
        if !firstLoadDone {
            spinner.isHidden = false
            spinner.startAnimation(nil)
            webView.load(URLRequest(url: Config.shared.url))
        } else {
            webView.reload()
        }
    }
    @objc func newMedicineRecord(_ sender: Any?) { run(clickScript(page: 0, id: "manual")) }
    @objc func newMedicine(_ sender: Any?) { run(clickScript(page: 0, id: "add-med")) }
    @objc func newVisit(_ sender: Any?) { run(clickScript(page: 1, id: "visit-add")) }
    @objc func newAppointment(_ sender: Any?) { run(clickScript(page: 1, id: "appointment-add")) }
    @objc func newCheckup(_ sender: Any?) { run(clickScript(page: 2, id: "checkup-add")) }
    @objc func importCheckup(_ sender: Any?) { run(clickScript(page: 2, id: "checkup-import-open")) }
    @objc func exportBackup(_ sender: Any?) { run(clickScript(page: 0, id: "export")) }
    @objc func importBackup(_ sender: Any?) { run(clickScript(page: 0, id: "import")) }
    @objc func findInPage(_ sender: Any?) {
        run(clickScript(page: 1, id: nil) + "setTimeout(()=>document.getElementById('visits-filter')?.focus(),120);")
    }
    @objc func zoomIn(_ sender: Any?) { webView.pageZoom = min(webView.pageZoom + 0.1, 2) }
    @objc func zoomOut(_ sender: Any?) { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
    @objc func zoomReset(_ sender: Any?) { webView.pageZoom = 1 }

    private func run(_ js: String) { webView.evaluateJavaScript(js, completionHandler: nil) }

    /// 未登录时，和记录有关的菜单项变灰
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(switchPage(_:)):
            item.state = (item.tag == segmented.selectedSegment) ? .on : .off
            return signedIn
        case #selector(newMedicineRecord(_:)), #selector(newMedicine(_:)), #selector(newVisit(_:)),
             #selector(newAppointment(_:)), #selector(newCheckup(_:)), #selector(importCheckup(_:)), #selector(exportBackup(_:)), #selector(importBackup(_:)),
             #selector(findInPage(_:)):
            return signedIn
        default:
            return true
        }
    }

    // MARK: 回到前台时按需刷新

    func noteInactive() { leftAt = Date() }
    func reloadIfStale() {
        guard let t = leftAt else { return }
        leftAt = nil
        if Date().timeIntervalSince(t) > staleAfter { webView.reload() }
    }

    // MARK: 网页 → 外壳

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        signedIn = body["signedIn"] as? Bool ?? false
        segmented.selectedSegment = min(max(body["page"] as? Int ?? 0, 0), 2)
        updateChrome()
    }

    // MARK: 加载状态

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        firstLoadDone = true
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        errorView.isHidden = true
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { showError(e) }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { showError(e) }
    private func showError(_ e: Error) {
        let ns = e as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        spinner.isHidden = true
        if !firstLoadDone { errorView.isHidden = false }
    }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }

    // 导出备份（网页用 <a download> 触发）→ 走下载流程，让用户选保存位置
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.shouldPerformDownload ? .download : .allow)
    }
    func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }
    func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.message = "选择备份文件的保存位置"
        guard let window else { completionHandler(nil); return }
        panel.beginSheetModal(for: window) { r in
            guard r == .OK, let url = panel.url else { completionHandler(nil); return }
            try? FileManager.default.removeItem(at: url)
            completionHandler(url)
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        alert("备份没有保存成功", error.localizedDescription)
    }

    // MARK: 网页里的确认框、提示框、选文件、新窗口

    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "好")
        sheet(a) { _ in completionHandler() }
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        let destructive = message.hasPrefix("删除")
        let ok = a.addButton(withTitle: destructive ? "删除" : "确定")
        ok.hasDestructiveAction = destructive
        a.addButton(withTitle: "取消")
        sheet(a) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ w: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.json]
        panel.message = "选择之前导出的备份文件"
        guard let window else { completionHandler(nil); return }
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }
    /// target=_blank 的链接（如地图版权说明）用默认浏览器打开
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    private func sheet(_ a: NSAlert, _ done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible { a.beginSheetModal(for: window, completionHandler: done) } else { done(a.runModal()) }
    }
    private func alert(_ title: String, _ detail: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = detail
        sheet(a) { _ in }
    }
}

/// 避免 WKUserContentController 和窗口控制器互相强引用
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

// MARK: - 菜单栏

enum AppMenus {
    static func item(_ title: String, _ action: Selector?, _ key: String = "",
                     _ mods: NSEvent.ModifierFlags = .command, tag: Int = 0) -> NSMenuItem {
        let m = NSMenuItem(title: title, action: action, keyEquivalent: key)
        m.keyEquivalentModifierMask = mods
        m.tag = tag
        return m
    }

    static func newItemsMenu() -> NSMenu {
        let m = NSMenu(title: "新建")
        m.addItem(item("补记一次用药", #selector(MainWindowController.newMedicineRecord(_:))))
        m.addItem(item("添加药物", #selector(MainWindowController.newMedicine(_:))))
        m.addItem(.separator())
        m.addItem(item("记一次就诊", #selector(MainWindowController.newVisit(_:))))
        m.addItem(item("添加预约", #selector(MainWindowController.newAppointment(_:))))
        m.addItem(.separator())
        m.addItem(item("粘贴导入体检报告", #selector(MainWindowController.importCheckup(_:))))
        m.addItem(item("手动新建体检报告", #selector(MainWindowController.newCheckup(_:))))
        return m
    }

    static func build() -> NSMenu {
        let name = Config.shared.title
        let main = NSMenu()

        let app = NSMenu(title: name)
        app.addItem(item("关于\(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        app.addItem(.separator())
        let services = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
        services.submenu = NSMenu(title: "服务")
        NSApp.servicesMenu = services.submenu
        app.addItem(services)
        app.addItem(.separator())
        app.addItem(item("隐藏\(name)", #selector(NSApplication.hide(_:)), "h"))
        app.addItem(item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        app.addItem(item("全部显示", #selector(NSApplication.unhideAllApplications(_:))))
        app.addItem(.separator())
        app.addItem(item("退出\(name)", #selector(NSApplication.terminate(_:)), "q"))

        let file = NSMenu(title: "文件")
        file.addItem(item("补记一次用药", #selector(MainWindowController.newMedicineRecord(_:)), "n"))
        file.addItem(item("添加药物", #selector(MainWindowController.newMedicine(_:)), "n", [.command, .shift]))
        file.addItem(item("记一次就诊", #selector(MainWindowController.newVisit(_:)), "n", [.command, .option]))
        file.addItem(item("添加预约", #selector(MainWindowController.newAppointment(_:))))
        file.addItem(.separator())
        file.addItem(item("导入备份…", #selector(MainWindowController.importBackup(_:)), "o"))
        file.addItem(item("导出备份…", #selector(MainWindowController.exportBackup(_:)), "e", [.command, .shift]))
        file.addItem(.separator())
        file.addItem(item("关闭窗口", #selector(NSWindow.performClose(_:)), "w"))

        // 编辑菜单：没有它，网页输入框里的 ⌘C / ⌘V / ⌘Z 都不起作用
        let edit = NSMenu(title: "编辑")
        edit.addItem(item("撤销", Selector(("undo:")), "z"))
        edit.addItem(item("重做", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("剪切", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("拷贝", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("粘贴", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("全选", #selector(NSText.selectAll(_:)), "a"))
        edit.addItem(.separator())
        edit.addItem(item("搜索就诊记录", #selector(MainWindowController.findInPage(_:)), "f"))

        let view = NSMenu(title: "显示")
        view.addItem(item("用药记录", #selector(MainWindowController.switchPage(_:)), "1", tag: 0))
        view.addItem(item("看病记录", #selector(MainWindowController.switchPage(_:)), "2", tag: 1))
        view.addItem(item("体检报告", #selector(MainWindowController.switchPage(_:)), "3", tag: 2))
        view.addItem(.separator())
        view.addItem(item("重新载入", #selector(MainWindowController.reloadPage(_:)), "r"))
        view.addItem(.separator())
        view.addItem(item("实际大小", #selector(MainWindowController.zoomReset(_:)), "0"))
        view.addItem(item("放大", #selector(MainWindowController.zoomIn(_:)), "+"))
        view.addItem(item("缩小", #selector(MainWindowController.zoomOut(_:)), "-"))
        view.addItem(.separator())
        view.addItem(item("进入全屏幕", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))

        let window = NSMenu(title: "窗口")
        window.addItem(item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"))
        window.addItem(item("缩放", #selector(NSWindow.performZoom(_:))))
        window.addItem(.separator())
        window.addItem(item("前置全部窗口", #selector(NSApplication.arrangeInFront(_:))))
        NSApp.windowsMenu = window

        for sub in [app, file, edit, view, window] {
            let top = NSMenuItem(title: sub.title, action: nil, keyEquivalent: "")
            top.submenu = sub
            main.addItem(top)
        }
        return main
    }
}

// MARK: - 入口

final class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: MainWindowController!

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.mainMenu = AppMenus.build()
        controller = MainWindowController()
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        let nc = NotificationCenter.default
        nc.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.controller.noteInactive()
        }
        nc.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.controller.reloadIfStale()
        }
    }
    /// 关掉窗口后点 Dock 图标，重新打开窗口（和系统自带应用一样）
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { controller.showWindow(nil) }
        return true
    }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}

@main
enum Main {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
