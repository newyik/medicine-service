# 吃药服务 · 开发说明

用药记录 + 看病记录的网页应用，外加 Mac 和 iPhone 两个原生外壳。以后只在这个目录开发。

## ⚠️ 公开仓库：绝对不能放密钥

- 仓库是公开的，main 分支根目录直接发布成网站，`apps/` 也公开。
- 不能提交任何密钥、密码、令牌、证书、描述文件，也不能提交 Supabase 的 service_role key。
- `config.js` 里的 Supabase 地址和 `sb_publishable_…` 是设计上公开的前端密钥，安全靠数据库的行级权限。只能放这类公开值。
- **推送前必须先问仓库主人**，提交可以在本地做。

## 组成

| 部分 | 位置 | 是什么 |
|---|---|---|
| 网页 | 根目录：`index.html`、`style.css`、`app.js`、`visits.js`、`email-auth.js`、`journal-cache.js`、`config.js`、`assets/` | 全部功能都在这里（用药、看病、预约提醒、邮箱登录、云同步）。线上：https://newyik.github.io/medicine-service/ |
| Mac 外壳 | `apps/mac/` | Swift 写的 WebView 外壳（`App.swift`），加载线上网页；`Appearance.css` 做原生外观适配 |
| iPhone 外壳 | `apps/ios/` | Swift/UIKit WebView 外壳，加载线上网页，提供原生导航栏、标签栏、下拉刷新、分享导出；会给 `<html>` 加 `native-ios` 类 |
| 安装说明 | `apps/docs/iPhone安装说明.md` | Sideloadly 侧载步骤 |

外壳里没有业务逻辑，改功能改网页就行。网页发布后，外壳会自动加载新版。

## 旧规矩（必须遵守）

- **没有构建步骤。** 直接改 `app.js` / `visits.js` / `email-auth.js` / `index.html` / `style.css`，不要引入打包工具或框架。
- **数据库结构在 `migrations/`，按文件名顺序执行**（`000-schema.sql` → `preserve-visits.sql`）。新增结构就加新文件，文件名要能排在已有文件之后。
- **每个账号在 `medicine_journals` 表里只有一行 JSON**，保存时带版本号检查（乐观锁），版本冲突要处理，不能盲目覆盖。
- **仍开着旧版页面的设备会把数据写回来。** 新增字段时必须考虑：旧客户端不认识这个字段，保存时会不会把它冲掉。`migrations/preserve-visits.sql` 就是为此加的，它让数据库保留旧客户端不认识的字段。以后新增顶层字段，也要用同样的方法保护。
- **提醒只在页面打开时显示，没有后台推送。** 不要说成有锁屏或后台通知。

## 测试

```bash
node --test tests/*.test.mjs
```

不需要安装依赖。改动网页逻辑后必须全部通过。

本地预览：在根目录起一个静态服务器（例如 `python3 -m http.server 8765`），打开 http://localhost:8765/ 。开发预览使用模拟数据，不连接真实账号。iPhone 外壳可以用启动参数 `-medicineURL http://localhost:8765/` 加载本地页面。

## 发布

GitHub Pages 从 **main 分支根目录**发布，推送到 main 就上线（推送前先问）。数据库改动要在 Supabase 里按顺序手动执行 `migrations/` 下的新文件。

## 外壳构建与安装

构建产物（`apps/*/build/`、`*.ipa`、`*.app`）已被 `.gitignore` 忽略，不要提交。

**Mac：**

```bash
apps/mac/build.sh            # 生成 apps/mac/build/吃药服务.app
apps/mac/build.sh --install  # 再替换 /Applications/吃药服务.app
```

使用 ad-hoc 签名，目标 arm64、macOS 13 以上。

**iPhone：**

```bash
apps/ios/build.sh   # 生成 apps/ios/吃药服务-iPhone-待签名.ipa
```

生成的是未签名 IPA，再用 Sideloadly 侧载签名，步骤见 `apps/docs/iPhone安装说明.md`。不要改 bundle ID（免费开发账号最多 3 个侧载 App）。目标 iOS 16 以上。
