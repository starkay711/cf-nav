# cf-nav v2.1 部署说明

个人导航主页，基于 Cloudflare Worker + KV，Apple 风格 UI，支持管理后台。

## 功能特点

- 🔍 多搜索引擎切换
- ⚡ 快速访问图标（自动获取网站 Favicon）
- 📂 分类书签管理
- 🎨 背景/主题自定义
- 🔐 管理后台（登录鉴权）
- 📱 移动端适配

---

## 部署步骤

### 1. 创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **Workers & Pages** → **KV**
3. 点击 **Create namespace**，名称填 `NAV_KV`，点击 Add

### 2. 创建 Worker

1. 左侧菜单 → **Workers & Pages** → **Create application** → **Create Worker**
2. 给 Worker 起个名字（如 `cf-nav`），点击 Deploy
3. 进入 Worker 详情页 → 点击右上角 **Edit Code**
4. 将 `worker.js` 的内容全部粘贴进去，点击 **Deploy**

### 3. 绑定 KV

1. Worker 详情页 → **Settings** → **Variables**
2. 找到 **KV Namespace Bindings**，点击 **Add binding**
3. 变量名填 `NAV_KV`，选择刚才创建的命名空间
4. 点击 **Save**，然后重新部署一次 Worker

### 4. 初始化账户

1. 访问 `https://你的Worker域名/admin`
2. 首次访问会显示注册页，填写用户名和密码
3. 登录后即可在管理后台配置导航内容

---

## 目录结构

```
cf-nav/
└── worker.js    # 全部代码（单文件部署）
```

---

## 管理后台功能

| 页面 | 说明 |
|------|------|
| 外观设置 | 背景图/颜色/渐变、主题（浅色/深色/跟随系统）、搜索引擎 |
| 快速访问 | 顶部小图标管理，图标自动从网址获取 |
| 分类导航 | 书签分类及网站管理，图标自动从网址获取 |
| 系统设置 | 修改密码、注册权限、配置导入导出 |

---

## 常见问题

**Q：图标显示不出来？**  
A：图标使用 Google Favicon 服务获取，需要访问 `www.google.com`，国内网络可能受限。可在管理后台手动上传自定义图标替代。

**Q：忘记密码怎么办？**  
A：进入 Cloudflare KV 控制台，找到 `NAV_KV` 命名空间，删除 `admin` 这个 key，然后重新访问 `/admin` 注册。

**Q：如何绑定自定义域名？**  
A：Worker 详情页 → **Triggers** → **Custom Domains** → 添加你的域名即可。

---

## 注意事项

- 免费版 Worker 每天有 **10 万次**请求限额，个人使用完全够用
- KV 免费版支持 **1GB** 存储，背景图建议控制在 5MB 以内
- 配置数据建议定期通过管理后台「导出配置」备份
