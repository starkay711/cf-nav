# cf-nav — 个人导航主页

[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/cf-nav)

一个部署在 **Cloudflare Pages** 上的个人导航主页，专为 Chrome 浏览器主页设计。

## ✨ 功能特性

- 🕐 **实时时钟** — 显示当前时间和日期
- 🔍 **多引擎搜索** — 支持 Google / Bing / 百度 一键切换
- ⚡ **快速访问** — 常用网站图标快捷入口
- 📂 **分类导航** — 按类别整理网站书签
- ✏️ **可视化编辑** — 点击编辑按钮，可添加/删除/修改网站和分类
- 🌙 **深色/浅色主题** — 一键切换，偏好自动记忆
- 💾 **本地持久化** — 所有配置保存在浏览器 localStorage
- 📱 **响应式设计** — 适配桌面和移动端

## 🚀 部署方式（Cloudflare Pages）

### 方法一：通过 Git 仓库部署（推荐）

1. 将本项目推送到 GitHub / GitLab 仓库
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
3. 进入 **Workers & Pages** → **Create application** → **Pages**
4. 连接你的 Git 仓库，选择 `cf-nav`
5. 构建配置：
   - **Framework preset**: `None`
   - **Build command**: （留空）
   - **Build output directory**: `/`（根目录）
6. 点击 **Save and Deploy** — 几秒内完成部署！

### 方法二：直接上传（无需 Git）

1. 登录 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages**
2. 选择 **Upload assets**
3. 拖拽 `index.html` 文件上传
4. 点击 **Deploy site** 完成

### 设置为 Chrome 主页

1. Chrome 设置 → **打开新标签页时** → 自定义
2. 或者：设置 → 搜索"启动时" → **打开特定网页** → 添加你的 Cloudflare Pages 域名
3. 推荐使用 [New Tab Redirect](https://chrome.google.com/webstore/detail/new-tab-redirect/icpgjfneehieebagbmdbhnlpiopdcmna) 扩展将新标签页重定向到你的导航

## 🛠️ 本地开发

```bash
# 直接在浏览器中打开即可，无需构建
open index.html

# 或使用本地服务器
npx serve .
# 访问 http://localhost:3000
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + K` | 聚焦搜索框 |
| `Enter` | 执行搜索 |

## 🎨 个性化

打开导航页后：
1. 点击右上角 **✏️ 编辑按钮** 进入编辑模式
2. 可以添加、删除、编辑任意网站或分类
3. 点击 **✅** 退出编辑并自动保存
4. 点击 **☀️/🌙** 切换主题
