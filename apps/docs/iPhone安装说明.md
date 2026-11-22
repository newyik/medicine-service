# 吃药服务与小家控 iPhone 版

安装包：吃药服务-iPhone-待签名.ipa、小家控-iPhone-待签名.ipa。

## 安装

1. 打开 Mac 上的 Sideloadly，选择已配对的 iPhone。
2. 先拖入“吃药服务-iPhone-待签名.ipa”，使用安装日和账本时的同一个 Apple 账号，启用 Automatic Refresh，然后点 Start。
3. 按工具提示自行输入密码或验证码。Done 后在手机打开吃药服务。
4. 再把“小家控-iPhone-待签名.ipa”拖入，按同样步骤安装，并同样开启自动续签。
5. 用各自原有账号登录。Apple 签名账号与业务登录账号是两个不同用途的账号。

不要删除已安装的日和账本，也不要更改三个应用的 bundle ID。免费开发账号同时最多三个侧载 App，日和账本、吃药服务、小家控合计正好三个。来自 App Store 的普通 App 不计入此侧载数量。官方说明：https://sideloadly.io/faq

## 功能与边界

- 吃药服务加载 https://newyik.github.io/medicine-service/ ，保留原来的用药、看病、预约与登录功能。支持邮箱密码，GitHub 登录仍需实际手机验收。不修改后端账号或医疗记录。
- 小家控加载 https://newyik.github.io/home/ ，保留原有清单、地图、共享家庭与登录。
- 各自原生应用、图标、持久化网站存储与 bundle ID 独立。
- 使用已修复的 UIWindowSceneDelegate 生命周期，避免日和账本首版在 iOS 27 上的启动问题。
- 页面使用线上版本；启动获取网站，前台每分钟检查线上 HTML 和同源 JS/CSS 的版本响应头。没有输入中的表单时刷新。GitHub Pages 路径按每个应用的子目录处理。
- 支持下拉刷新、文件下载分享／保存、JavaScript 确认弹窗；小家控如使用地图定位，会由系统请求使用时定位权限。
- 吃药服务现有提醒以页面打开时为主，不额外提供锁屏或后台用药通知。
- 自动续签需要每个 App 单独登记。现有 Sideloadly 后台与 Finder 无线连接设置可以继续使用；最终需确认两个 App 都进入自动续签名单。

## 验证

已验证两个线上地址返回 200，两个 iOS arm64 应用编译成功、IPA 结构与 ZIP 完整性通过、SceneDelegate 与 Info.plist 匹配、三个 bundle ID 均不同。

尚待真实签名安装、启动登录、读取与新增测试记录、跨设备同步、后台自动续签验收。未修改网页版代码及后端数据。

源码位于“吃药服务-iOS源代码”与“小家控-iOS源代码”；各自 build.sh 可重建待签名 IPA。
