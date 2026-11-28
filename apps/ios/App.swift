// 吃药服务 iPhone 外壳
// 业务逻辑全部在网页（medicine-service）里，这里负责“像一个 iPhone 应用”：
// 顶部原生导航栏（大标题 + ＋新建菜单）、底部原生标签栏（用药 / 看病）、跟随系统深浅色、
// 记录成功时轻震、下拉刷新、网页更新后自动刷新、导出备份走系统分享。
// 外壳会给网页 <html> 加 native-ios，网页据此隐藏自己的顶栏。
// 调试：启动参数 -medicineURL http://localhost:8765/ 可改为加载本地预览。

import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.tintColor = Palette.accent
        let nav = UINavigationController(rootViewController: WebsiteController())
        nav.navigationBar.prefersLargeTitles = true
        window.rootViewController = nav
        self.window = window
        window.makeKeyAndVisible()
    }
}

/// 与网页 style.css 的颜色变量保持一致
enum Palette {
    static func dyn(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? hex(dark) : hex(light) }
    }
    static func hex(_ v: UInt32) -> UIColor {
        UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
    static let background = dyn(0xf4f4f1, 0x121312)
    static let accent = dyn(0x2e6a58, 0x6cc4a6)
}

// MARK: - 注入网页的脚本

private let bridgeEarly = "document.documentElement.classList.add('native-ios');"
/// 登录状态、当前页面变化时告诉外壳；“已记录 / 已保存”之类的提示出现时请外壳轻震一下
private let bridgeLate = """
(function(){
  const post=m=>{try{webkit.messageHandlers.shell.postMessage(m)}catch(e){}};
  const state=()=>post({signedIn:!document.body.classList.contains('signed-out'),page:['visits','checkups'].indexOf(location.hash.slice(1))+1});
  new MutationObserver(state).observe(document.body,{attributes:true,attributeFilter:['class']});
  addEventListener('hashchange',state); state();
  const watch=id=>{const el=document.getElementById(id);if(!el)return;let last='';
    new MutationObserver(()=>{const t=el.textContent.trim();if(t&&t!==last&&/^已/.test(t))post({haptic:'success'});last=t;})
      .observe(el,{childList:true,characterData:true,subtree:true});};
  ['status','visit-status','appointment-action-status','backup-status','medicine-status','edit-status'].forEach(watch);
})();
"""

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

// MARK: - 主界面

final class WebsiteController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, UITabBarDelegate {
    let origin: URL = {
        if let s = UserDefaults.standard.string(forKey: "medicineURL"), let u = URL(string: s) { return u }
        return URL(string: "https://newyik.github.io/medicine-service/")!
    }()
    var web: WKWebView!
    let tabBar = UITabBar()
    var timer: Timer?
    var checking = false
    var signedIn = false
    var downloads: [WKDownload] = []
    var destinations: [ObjectIdentifier: URL] = [:]
    let haptic = UINotificationFeedbackGenerator()
    let tap = UISelectionFeedbackGenerator()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.background
        title = "用药记录"
        navigationItem.largeTitleDisplayMode = .always

        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: bridgeEarly, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: bridgeLate, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        ucc.add(WeakHandler(self), name: "shell")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController = ucc
        config.applicationNameForUserAgent = "MedicineiOS/2"
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        web.isOpaque = false; web.backgroundColor = Palette.background
        web.scrollView.backgroundColor = Palette.background
        web.scrollView.contentInsetAdjustmentBehavior = .automatic
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)

        // 底部标签栏：用药 / 看病
        tabBar.delegate = self
        let meds = UITabBarItem(title: "用药", image: UIImage(systemName: "pills"), selectedImage: UIImage(systemName: "pills.fill"))
        let visits = UITabBarItem(title: "看病", image: UIImage(systemName: "stethoscope"), tag: 1)
        meds.tag = 0
        let checkups = UITabBarItem(title: "体检", image: UIImage(systemName: "drop"), tag: 2)
        checkups.selectedImage = UIImage(systemName: "drop.fill")
        tabBar.items = [meds, visits, checkups]
        tabBar.selectedItem = meds
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(tabBar)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: tabBar.topAnchor),
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        // 右上角“＋”新建菜单
        let addMenu = UIMenu(children: [
            UIAction(title: "补记一次用药", image: UIImage(systemName: "clock.arrow.circlepath")) { [weak self] _ in self?.run(clickScript(page: 0, id: "manual")) },
            UIAction(title: "添加药物", image: UIImage(systemName: "pills")) { [weak self] _ in self?.run(clickScript(page: 0, id: "add-med")) },
            UIMenu(options: .displayInline, children: [
                UIAction(title: "记一次就诊", image: UIImage(systemName: "cross.case")) { [weak self] _ in self?.run(clickScript(page: 1, id: "visit-add")) },
                UIAction(title: "添加预约", image: UIImage(systemName: "calendar.badge.plus")) { [weak self] _ in self?.run(clickScript(page: 1, id: "appointment-add")) },
            ]),
            UIMenu(options: .displayInline, children: [
                UIAction(title: "粘贴导入体检报告", image: UIImage(systemName: "doc.on.clipboard")) { [weak self] _ in self?.run(clickScript(page: 2, id: "checkup-import-open")) },
                UIAction(title: "手动新建体检报告", image: UIImage(systemName: "drop")) { [weak self] _ in self?.run(clickScript(page: 2, id: "checkup-add")) },
            ]),
        ])
        navigationItem.rightBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "plus"), menu: addMenu)

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(manualRefresh), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        applyChrome(animated: false)
        web.load(URLRequest(url: origin, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        NotificationCenter.default.addObserver(self, selector: #selector(checkUpdate), name: UIScene.didActivateNotification, object: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.checkUpdate() }
    }
    deinit { timer?.invalidate(); NotificationCenter.default.removeObserver(self) }

    private func run(_ js: String) { web.evaluateJavaScript(js, completionHandler: nil) }

    /// 未登录时隐藏导航栏和标签栏，整屏显示登录页
    func applyChrome(animated: Bool) {
        navigationController?.setNavigationBarHidden(!signedIn, animated: animated)
        tabBar.isHidden = !signedIn
        title = pageTitles[tabBar.selectedItem?.tag ?? 0]
    }

    // 标签栏切换
    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        tap.selectionChanged()
        run(clickScript(page: item.tag, id: nil) + "window.scrollTo(0,0);")
        title = pageTitles[item.tag]
    }

    // 网页 → 外壳
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["haptic"] != nil { haptic.notificationOccurred(.success); return }
        let wasSignedIn = signedIn
        signedIn = body["signedIn"] as? Bool ?? false
        let page = min(max(body["page"] as? Int ?? 0, 0), 2)
        tabBar.selectedItem = tabBar.items?[page]
        applyChrome(animated: wasSignedIn != signedIn)
    }

    // MARK: 刷新与自动更新（沿用原逻辑）

    let dirty = "!!document.querySelector('dialog[open]') || Array.from(document.querySelectorAll('form input:not([type=date]):not([type=checkbox])')).some(e=>e.value.trim())"
    @objc func manualRefresh() {
        web.scrollView.refreshControl?.endRefreshing()
        web.evaluateJavaScript(dirty) { [weak self] result, _ in
            guard let self = self else { return }
            if result as? Bool == true {
                let alert = UIAlertController(title: "刷新前请保存输入", message: "继续刷新可能丢失未提交的内容。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "继续编辑", style: .cancel))
                alert.addAction(UIAlertAction(title: "仍然刷新", style: .destructive) { _ in self.web.reloadFromOrigin() })
                self.present(alert, animated: true)
            } else { self.web.reloadFromOrigin() }
        }
    }
    @objc func checkUpdate() {
        guard UIApplication.shared.applicationState == .active, web != nil, !web.isLoading, !checking, web.url?.host == origin.host else { return }
        checking = true
        let script = """
        if (document.querySelector('dialog[open]') || Array.from(document.querySelectorAll('form input:not([type=date]):not([type=checkbox])')).some(e=>e.value.trim()) || document.activeElement?.matches('input,textarea,select')) return false;
        const root=location.origin+location.pathname;
        const r=await fetch(root,{credentials:'same-origin',cache:'no-store'});if(!r.ok)return false;
        const html=await r.text();
        const doc=new DOMParser().parseFromString(html,'text/html');
        const assets=Array.from(doc.querySelectorAll('script[src],link[rel=stylesheet][href]')).map(e=>new URL(e.getAttribute('src')||e.getAttribute('href'),root).href).filter(u=>new URL(u).origin===new URL(root).origin);
        const heads=await Promise.all(assets.map(async u=>{const h=await fetch(u,{method:'HEAD',cache:'no-store'});if(!h.ok)throw Error('asset unavailable');return [u,h.headers.get('etag'),h.headers.get('last-modified'),h.headers.get('content-length')]}));
        const signature=html+JSON.stringify(heads);
        const changed=typeof window.__nativeRelease==='string' && window.__nativeRelease!==signature;
        window.__nativeRelease=signature;return changed;
        """
        web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self = self else { return }; self.checking = false
            if case .success(let value) = result, value as? Bool == true { self.web.reloadFromOrigin() }
        }
    }

    // MARK: 加载

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { web.scrollView.refreshControl?.endRefreshing(); checkUpdate() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    func showError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled, presentedViewController == nil else { return }
        let alert = UIAlertController(title: "暂时连不上", message: "请检查网络后重试。云端已保存的记录不会丢失。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重试", style: .default) { _ in self.web.load(URLRequest(url: self.origin, cachePolicy: .reloadIgnoringLocalCacheData)) })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel)); present(alert, animated: true)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload { decisionHandler(.download); return }
        if ["https", "http", "about", "blob", "data"].contains(url.scheme ?? "") { decisionHandler(.allow) }
        else { decisionHandler(.cancel); UIApplication.shared.open(url) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) { decisionHandler(response.canShowMIMEType ? .allow : .download) }

    // MARK: 导出备份 → 系统分享面板

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { downloads.append(download); download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { downloads.append(download); download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent((suggestedFilename as NSString).lastPathComponent)
            destinations[ObjectIdentifier(download)] = url; completionHandler(url)
        } catch { completionHandler(nil); showError(error) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        downloads.removeAll { $0 === download }
        guard let url = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        share.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        present(share, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeAll { $0 === download }
        if let url = destinations.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        showError(error)
    }

    // MARK: 网页弹框 → 系统弹框

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() }); present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let destructive = message.hasPrefix("删除")
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: destructive ? "删除" : "确定", style: destructive ? .destructive : .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert); a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }
}

/// 避免脚本消息处理器和页面互相强引用
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
