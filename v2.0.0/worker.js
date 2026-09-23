/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  cf-nav v2.1  ·  Personal Navigation Hub            ║
 * ║  Cloudflare Worker + KV Storage                     ║
 * ║  Apple-style · Admin Backend · Multi-device Sync    ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * KV Keys used:
 *   config      → JSON navigation configuration
 *   admin       → { username, passwordHash }
 *   reg_config  → { mode, inviteCode }
 *   bg_image    → base64 background image (optional)
 *   session:{t} → { username, expires } with KV TTL
 */

// ─────────────────────────────────────────────────────────
// 1. CONSTANTS & DEFAULT DATA
// ─────────────────────────────────────────────────────────

const TOKEN_TTL = 86400 * 7; // 7 days in seconds

const DEFAULT_CONFIG = {
  siteTitle: '我的导航',
  favicon: '🏠',
  theme: 'light',
  background: { type: 'default', value: '', overlay: 0, blur: false },
  searchEngine: 'google',
  engines: [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
    { id: 'bing',   name: 'Bing',   url: 'https://www.bing.com/search?q='   },
    { id: 'baidu',  name: '百度',   url: 'https://www.baidu.com/s?wd='      },
  ],
  quickLinks: [
    { id: 'q1', name: 'GitHub',  url: 'https://github.com'      },
    { id: 'q2', name: 'Gmail',   url: 'https://mail.google.com' },
    { id: 'q3', name: 'YouTube', url: 'https://youtube.com'     },
    { id: 'q4', name: '知乎',    url: 'https://zhihu.com'       },
    { id: 'q5', name: 'B站',     url: 'https://bilibili.com'    },
  ],
  categories: [
    {
      id: 'dev', name: '开发工具', icon: '🛠️',
      sites: [
        { id:'s1', name:'GitHub',         url:'https://github.com',            desc:'代码托管' },
        { id:'s2', name:'MDN',            url:'https://developer.mozilla.org', desc:'Web文档' },
        { id:'s3', name:'Stack Overflow', url:'https://stackoverflow.com',     desc:'开发问答' },
        { id:'s4', name:'Cloudflare',     url:'https://dash.cloudflare.com',   desc:'网络服务' },
        { id:'s5', name:'Vercel',         url:'https://vercel.com',            desc:'前端部署' },
        { id:'s6', name:'npm',            url:'https://npmjs.com',             desc:'包管理'  },
      ]
    },
    {
      id: 'ai', name: 'AI 工具', icon: '🤖',
      sites: [
        { id:'s7',  name:'ChatGPT',    url:'https://chat.openai.com',   desc:'OpenAI'    },
        { id:'s8',  name:'Claude',     url:'https://claude.ai',         desc:'Anthropic' },
        { id:'s9',  name:'Gemini',     url:'https://gemini.google.com', desc:'Google AI' },
        { id:'s10', name:'Perplexity', url:'https://perplexity.ai',     desc:'AI搜索'    },
      ]
    },
    {
      id: 'design', name: '设计资源', icon: '🎨',
      sites: [
        { id:'s11', name:'Figma',    url:'https://figma.com',    desc:'UI设计' },
        { id:'s12', name:'Unsplash', url:'https://unsplash.com', desc:'免费图片' },
        { id:'s13', name:'Coolors',  url:'https://coolors.co',   desc:'配色工具' },
      ]
    },
  ],
};

// ─────────────────────────────────────────────────────────
// 2. MAIN ROUTER
// ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (!env.NAV_KV) {
      return new Response(setupGuideHTML(), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (path === '/api/status')         return apiStatus(env);
      if (path === '/api/setup'           && request.method === 'POST') return apiSetup(request, env);
      if (path === '/api/login'           && request.method === 'POST') return apiLogin(request, env);
      if (path === '/api/logout'          && request.method === 'POST') return apiLogout(request, env);
      if (path === '/api/verify'          && request.method === 'GET')  return apiVerify(request, env);
      if (path === '/api/config'          && request.method === 'GET')  return apiGetConfig(env);
      if (path === '/api/config'          && request.method === 'PUT')  return apiPutConfig(request, env);
      if (path === '/api/upload/bg'       && request.method === 'POST') return apiUploadBg(request, env);
      if (path === '/api/bg'              && request.method === 'GET')  return apiGetBg(env);

      if (path === '/')       return htmlResponse(navPageHTML());
      if (path === '/admin')  return htmlResponse(adminPageHTML());

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};

// ─────────────────────────────────────────────────────────
// 3. AUTH API HANDLERS
// ─────────────────────────────────────────────────────────

async function apiStatus(env) {
  const admin     = await env.NAV_KV.get('admin', 'json');
  const regConfig = await env.NAV_KV.get('reg_config', 'json') || { mode: 'closed', inviteCode: '' };
  return jsonResponse({
    initialized:    !!admin,
    registerMode:   regConfig.mode,
    requireInvite:  regConfig.mode === 'invite',
  });
}

async function apiSetup(request, env) {
  const body = await request.json();
  const { username, password, inviteCode } = body;

  const existing = await env.NAV_KV.get('admin', 'json');
  if (existing) {
    const regConfig = await env.NAV_KV.get('reg_config', 'json') || { mode: 'closed', inviteCode: '' };
    if (regConfig.mode === 'closed') {
      return jsonResponse({ error: '注册已关闭，请联系管理员' }, 403);
    }
    if (regConfig.mode === 'invite') {
      if (!inviteCode || inviteCode !== regConfig.inviteCode) {
        return jsonResponse({ error: '邀请码无效' }, 403);
      }
    }
    if (!username || !password) return jsonResponse({ error: '用户名和密码不能为空' }, 400);
    const hash = await hashPassword(password);
    await env.NAV_KV.put('admin', JSON.stringify({ username, passwordHash: hash }));
    const token = await createSession(env, username);
    return jsonResponse({ token, username });
  }

  if (!username || !password) return jsonResponse({ error: '用户名和密码不能为空' }, 400);
  const hash = await hashPassword(password);
  await env.NAV_KV.put('admin', JSON.stringify({ username, passwordHash: hash }));
  await env.NAV_KV.put('reg_config', JSON.stringify({ mode: 'closed', inviteCode: '' }));
  await env.NAV_KV.put('config', JSON.stringify(DEFAULT_CONFIG));
  const token = await createSession(env, username);
  return jsonResponse({ token, username });
}

async function apiLogin(request, env) {
  const body = await request.json();
  const { username, password } = body;
  if (!username || !password) return jsonResponse({ error: '请输入用户名和密码' }, 400);
  const admin = await env.NAV_KV.get('admin', 'json');
  if (!admin) return jsonResponse({ error: '系统未初始化' }, 400);
  const hash = await hashPassword(password);
  if (admin.username !== username || admin.passwordHash !== hash) {
    return jsonResponse({ error: '用户名或密码错误' }, 401);
  }
  const token = await createSession(env, username);
  return jsonResponse({ token, username });
}

async function apiLogout(request, env) {
  const token = extractToken(request);
  if (token) await env.NAV_KV.delete(`session:${token}`);
  return jsonResponse({ ok: true });
}

async function apiVerify(request, env) {
  const token = extractToken(request);
  if (!token) return jsonResponse({ valid: false }, 401);
  const session = await env.NAV_KV.get(`session:${token}`, 'json');
  if (!session) return jsonResponse({ valid: false }, 401);
  return jsonResponse({ valid: true, username: session.username });
}

// ─────────────────────────────────────────────────────────
// 4. CONFIG & UPLOAD API HANDLERS
// ─────────────────────────────────────────────────────────

async function apiGetConfig(env) {
  const config = await env.NAV_KV.get('config', 'json') || DEFAULT_CONFIG;
  return jsonResponse(config);
}

async function apiPutConfig(request, env) {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const body = await request.json();
  if (body._regConfig) {
    const { mode, inviteCode } = body._regConfig;
    await env.NAV_KV.put('reg_config', JSON.stringify({ mode, inviteCode: inviteCode || '' }));
    delete body._regConfig;
  }
  if (body._changePassword) {
    const { newPassword } = body._changePassword;
    if (newPassword) {
      const admin = await env.NAV_KV.get('admin', 'json');
      if (admin) {
        admin.passwordHash = await hashPassword(newPassword);
        await env.NAV_KV.put('admin', JSON.stringify(admin));
      }
    }
    delete body._changePassword;
  }
  if (Object.keys(body).length > 0) {
    await env.NAV_KV.put('config', JSON.stringify(body));
  }
  return jsonResponse({ ok: true });
}

async function apiUploadBg(request, env) {
  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const body = await request.json();
  const { dataUrl } = body;
  if (!dataUrl) return jsonResponse({ error: '无效数据' }, 400);
  if (dataUrl.length > 7_000_000) return jsonResponse({ error: '图片过大，请控制在 5MB 以内' }, 400);
  await env.NAV_KV.put('bg_image', dataUrl);
  return jsonResponse({ ok: true, url: '/api/bg' });
}

async function apiGetBg(env) {
  const dataUrl = await env.NAV_KV.get('bg_image');
  if (!dataUrl) return new Response('Not Found', { status: 404 });
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return new Response('Invalid', { status: 400 });
  const [, contentType, b64] = match;
  const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'max-age=3600',
    }
  });
}

// ─────────────────────────────────────────────────────────
// 5. UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────

async function hashPassword(password) {
  const enc    = new TextEncoder();
  const data   = enc.encode(password + 'cf-nav-salt-2024');
  const hash   = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(env, username) {
  const token = crypto.randomUUID().replace(/-/g, '');
  await env.NAV_KV.put(
    `session:${token}`,
    JSON.stringify({ username, expires: Date.now() + TOKEN_TTL * 1000 }),
    { expirationTtl: TOKEN_TTL }
  );
  return token;
}

function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

async function requireAuth(request, env) {
  const token = extractToken(request);
  if (!token) return jsonResponse({ error: '未授权' }, 401);
  const session = await env.NAV_KV.get(`session:${token}`, 'json');
  if (!session) return jsonResponse({ error: 'Token 无效或已过期，请重新登录' }, 401);
  return null;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

// ─────────────────────────────────────────────────────────
// 6. KV NOT BOUND — SETUP GUIDE PAGE
// ─────────────────────────────────────────────────────────

function setupGuideHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>cf-nav · 需要配置 KV</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#f5f5f7;display:grid;place-items:center;min-height:100vh;margin:0;color:#1d1d1f}
  .card{background:#fff;border-radius:20px;padding:48px;max-width:600px;box-shadow:0 4px 30px rgba(0,0,0,.1)}
  h1{font-size:1.6rem;margin-bottom:8px}
  p{color:#6e6e73;line-height:1.6}
  code{background:#f5f5f7;padding:2px 8px;border-radius:6px;font-size:.9em}
  ol{color:#1d1d1f;line-height:2}
</style></head><body>
<div class="card">
  <h1>⚠️ KV 命名空间未绑定</h1>
  <p>Worker 已部署，但需要绑定 Cloudflare KV 才能运行。请按以下步骤完成配置：</p>
  <ol>
    <li>进入 Cloudflare Dashboard → <strong>Workers & Pages → KV</strong></li>
    <li>点击 <strong>Create namespace</strong>，名称填 <code>NAV_KV</code></li>
    <li>返回你的 Worker → <strong>Settings → Variables</strong></li>
    <li>在 <strong>KV Namespace Bindings</strong> 中添加：<br>变量名 <code>NAV_KV</code> → 选择刚创建的命名空间</li>
    <li>点击 Save，然后重新部署 Worker</li>
  </ol>
</div>
</body></html>`;
}

// ─────────────────────────────────────────────────────────
// 7. NAVIGATION PAGE HTML (Apple-style, auto favicon)
// ─────────────────────────────────────────────────────────

function navPageHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>我的导航</title>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{height:100%;-webkit-font-smoothing:antialiased}
:root{
  --bg:#f5f5f7;
  --surface:rgba(255,255,255,0.72);
  --surface-solid:#ffffff;
  --border:rgba(0,0,0,0.08);
  --text:#1d1d1f;
  --muted:#6e6e73;
  --accent:#007aff;
  --accent-dark:#0055b3;
  --shadow:0 2px 20px rgba(0,0,0,0.06);
  --shadow-hover:0 8px 32px rgba(0,0,0,0.1);
  --radius:16px;
  --radius-sm:10px;
  --ease:cubic-bezier(0.25,0.1,0.25,1);
}
[data-theme=dark]{
  --bg:#000;
  --surface:rgba(28,28,30,0.8);
  --surface-solid:#1c1c1e;
  --border:rgba(255,255,255,0.1);
  --text:#f5f5f7;
  --muted:#98989d;
  --accent:#0a84ff;
  --shadow:0 2px 20px rgba(0,0,0,0.5);
  --shadow-hover:0 8px 32px rgba(0,0,0,0.7);
}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  transition:background .4s var(--ease),color .4s var(--ease);
  position:relative;
  overflow-x:hidden;
}
#bg-layer{
  position:fixed;inset:0;z-index:0;
  background-size:cover;background-position:center;
  transition:opacity .5s;
}
#bg-layer.blur-bg{filter:blur(8px) brightness(.8);transform:scale(1.05)}
#bg-overlay{position:fixed;inset:0;z-index:1;pointer-events:none}
.page{
  position:relative;z-index:2;
  max-width:1100px;margin:0 auto;
  padding:56px 24px 80px;
  display:flex;flex-direction:column;align-items:center;
}
.glass{
  background:var(--surface);
  backdrop-filter:saturate(180%) blur(20px);
  -webkit-backdrop-filter:saturate(180%) blur(20px);
  border:1px solid var(--border);
}
.search-section{width:100%;max-width:680px;margin-bottom:44px}
.search-wrap{
  display:flex;align-items:center;
  padding:12px 12px 12px 20px;
  border-radius:999px;
  box-shadow:var(--shadow);
  transition:box-shadow .25s var(--ease);
}
.search-wrap:focus-within{box-shadow:var(--shadow-hover),0 0 0 3px rgba(0,122,255,.18)}
.engine-pills{display:flex;gap:4px;margin-right:10px;flex-shrink:0}
.engine-pill{
  padding:5px 12px;border-radius:999px;
  border:1px solid var(--border);
  background:transparent;color:var(--muted);
  font-size:.76rem;font-weight:600;
  cursor:pointer;transition:all .2s var(--ease);
  font-family:inherit;
}
.engine-pill.active,.engine-pill:hover{
  background:var(--accent);border-color:var(--accent);color:#fff;
}
.search-input{
  flex:1;border:none;background:transparent;
  color:var(--text);font-size:1rem;outline:none;
  font-family:inherit;
}
.search-input::placeholder{color:var(--muted)}
.search-btn{
  width:38px;height:38px;border-radius:50%;
  border:none;background:var(--accent);
  color:#fff;cursor:pointer;
  display:grid;place-items:center;
  font-size:1rem;flex-shrink:0;
  transition:transform .2s var(--ease),filter .2s;
}
.search-btn:hover{transform:scale(1.08);filter:brightness(1.1)}
.quick-section{width:100%;margin-bottom:44px}
.section-title{
  font-size:.72rem;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;
  color:var(--muted);margin-bottom:14px;
}
.quick-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(78px,1fr));
  gap:10px;
}
.quick-link{
  display:flex;flex-direction:column;align-items:center;gap:7px;
  padding:16px 8px;border-radius:var(--radius-sm);
  text-decoration:none;color:var(--text);
  border:1px solid var(--border);
  transition:all .22s var(--ease);
  position:relative;
}
.quick-link:hover{
  box-shadow:var(--shadow-hover);
  transform:translateY(-3px);
  border-color:transparent;
}
.quick-link.add-link-btn{
  border-style:dashed;
  cursor:pointer;
  background:transparent;
}
.quick-link.add-link-btn:hover{
  border-color:var(--accent);
  color:var(--accent);
}
.quick-icon{
  width:40px;height:40px;border-radius:10px;
  display:grid;place-items:center;font-size:1.35rem;
  overflow:hidden;flex-shrink:0;background:var(--surface-solid);
}
.quick-icon img{width:32px;height:32px;object-fit:contain;border-radius:4px}
.quick-name{font-size:.7rem;color:var(--muted);text-align:center;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%}
.categories{width:100%;display:flex;flex-direction:column;gap:36px}
.cat-title{
  font-size:.8rem;font-weight:700;letter-spacing:1.2px;
  text-transform:uppercase;color:var(--muted);
  margin-bottom:14px;display:flex;align-items:center;gap:8px;
}
.cat-title::after{content:'';flex:1;height:1px;background:var(--border)}
.cat-add-btn{
  margin-left:auto;margin-right:8px;width:22px;height:22px;border-radius:50%;
  border:1px dashed var(--muted);background:transparent;color:var(--muted);
  font-size:.9rem;cursor:pointer;display:grid;place-items:center;
}
.cat-add-btn:hover{border-color:var(--accent);color:var(--accent)}
.site-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(210px,1fr));
  gap:10px;
}
.site-card{
  display:flex;align-items:center;gap:12px;
  padding:14px 16px;border-radius:var(--radius-sm);
  text-decoration:none;color:var(--text);
  border:1px solid var(--border);
  transition:all .22s var(--ease);
  overflow:hidden;
  position:relative;
}
.site-card:hover{
  box-shadow:var(--shadow-hover);
  transform:translateY(-2px);border-color:transparent;
}
.site-icon{
  width:38px;height:38px;border-radius:9px;
  display:grid;place-items:center;
  flex-shrink:0;overflow:hidden;
  background:var(--surface-solid);
}
.site-icon img{width:28px;height:28px;object-fit:contain;border-radius:4px}
.site-info{flex:1;min-width:0}
.site-name{font-size:.88rem;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.site-desc{font-size:.72rem;color:var(--muted);margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.site-arrow{font-size:.75rem;color:var(--muted);flex-shrink:0;
  opacity:0;transition:opacity .2s,transform .2s}
.site-card:hover .site-arrow{opacity:1;transform:translateX(2px)}
.item-del-btn{
  position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;
  background:rgba(255,59,48,0.88);color:#fff;border:none;cursor:pointer;
  font-size:10px;line-height:1;display:none;align-items:center;justify-content:center;z-index:5;
}
.quick-link:hover .item-del-btn,.site-card:hover .item-del-btn{display:flex}
.add-cat-btn{
  width:100%;margin-top:24px;padding:12px;border:1.5px dashed var(--border);
  background:transparent;border-radius:var(--radius-sm);color:var(--muted);
  cursor:pointer;font-size:.85rem;font-family:inherit;
}
.add-cat-btn:hover{border-color:var(--accent);color:var(--accent)}
.page-footer{
  position:fixed;bottom:20px;right:20px;z-index:10;
  display:flex;gap:8px;
}
.footer-btn{
  width:36px;height:36px;border-radius:50%;
  background:var(--surface);
  border:1px solid var(--border);
  color:var(--muted);font-size:.85rem;
  cursor:pointer;display:grid;place-items:center;
  text-decoration:none;
  box-shadow:var(--shadow);
  transition:all .2s var(--ease);
  backdrop-filter:blur(10px);
}
.footer-btn:hover{color:var(--accent);border-color:var(--accent)}
.nav-modal-mask{
  position:fixed;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(5px);
  z-index:200;display:none;place-items:center;
}
.nav-modal-mask.open{display:grid}
.nav-modal{
  background:var(--surface-solid);padding:24px;border-radius:18px;
  width:min(400px,90vw);box-shadow:0 10px 40px rgba(0,0,0,0.2);
}
.nav-modal h3{font-size:1.1rem;margin-bottom:14px;color:var(--text)}
.nav-modal input{
  width:100%;padding:10px 12px;margin-bottom:12px;border:1px solid var(--border);
  border-radius:8px;background:var(--bg);color:var(--text);outline:none;font-size:.9rem;font-family:inherit;
}
.nav-modal-btns{display:flex;justify-content:flex-end;gap:8px}
.nav-modal-btns button{
  padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:.85rem;font-weight:600;font-family:inherit;
}
.btn-c{background:transparent;border:1px solid var(--border)!important;color:var(--muted)}
.btn-s{background:var(--accent);color:#fff}
@media(max-width:600px){
  .page{padding:32px 16px 64px}
  .site-grid{grid-template-columns:1fr 1fr}
  .quick-grid{grid-template-columns:repeat(4,1fr)}
}
</style>
</head>
<body>
<div id="bg-layer"></div>
<div id="bg-overlay"></div>

<div class="page">
  <div class="search-section">
    <div class="search-wrap glass" id="search-wrap">
      <div class="engine-pills" id="engine-pills"></div>
      <input type="text" class="search-input" id="search-input"
        placeholder="搜索或输入网址…" autocomplete="off" spellcheck="false"/>
      <button class="search-btn" id="search-btn">→</button>
    </div>
  </div>

  <div class="quick-section" id="quick-section" style="display:none">
    <div class="section-title">快速访问</div>
    <div class="quick-grid" id="quick-grid"></div>
  </div>

  <div class="categories" id="categories"></div>
  <button class="add-cat-btn" id="nav-add-cat-btn" style="display:none">+ 添加分类</button>
</div>

<div class="page-footer">
  <button class="footer-btn" id="theme-btn" title="切换主题">☀</button>
  <a class="footer-btn" href="/admin" title="管理后台" id="admin-link">⚙</a>
</div>

<div class="nav-modal-mask" id="nav-quick-modal">
  <div class="nav-modal">
    <h3>添加快速访问</h3>
    <input id="nq-name" placeholder="网站名称（如：GitHub）"/>
    <input id="nq-url" placeholder="网址（如：https://github.com）"/>
    <div class="nav-modal-btns">
      <button class="btn-c" onclick="closeNavModal('nav-quick-modal')">取消</button>
      <button class="btn-s" id="nq-submit">添加</button>
    </div>
  </div>
</div>

<div class="nav-modal-mask" id="nav-site-modal">
  <div class="nav-modal">
    <h3>添加网站到分类</h3>
    <input id="ns-name" placeholder="网站名称"/>
    <input id="ns-url" placeholder="网址（如：https://github.com）"/>
    <input id="ns-desc" placeholder="简介描述（可选）"/>
    <div class="nav-modal-btns">
      <button class="btn-c" onclick="closeNavModal('nav-site-modal')">取消</button>
      <button class="btn-s" id="ns-submit">添加</button>
    </div>
  </div>
</div>

<div class="nav-modal-mask" id="nav-cat-modal">
  <div class="nav-modal">
    <h3>添加新分类</h3>
    <input id="nc-icon" placeholder="图标 Emoji（如：📁）" value="📁"/>
    <input id="nc-name" placeholder="分类名称"/>
    <div class="nav-modal-btns">
      <button class="btn-c" onclick="closeNavModal('nav-cat-modal')">取消</button>
      <button class="btn-s" id="nc-submit">添加</button>
    </div>
  </div>
</div>

<script>
let CFG = null;
let activeEngine = 'google';
let isAuthed = false;
let currentTargetCatId = null;

function faviconUrl(siteUrl) {
  try {
    const host = new URL(siteUrl).hostname;
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64';
  } catch(e) { return ''; }
}

function iconHtml(item) {
  const ico = (item.icon || '').trim();
  if (ico.startsWith('data:')) {
    return '<img src="' + ico + '" loading="lazy" alt=""/>';
  }
  const fav = faviconUrl(item.url || '');
  if (fav) {
    return '<img src="' + fav + '" loading="lazy" onerror="this.style.opacity=\\'0\\'" alt=""/>';
  }
  return '🔗';
}

function openNavModal(id) { document.getElementById(id).classList.add('open'); }
function closeNavModal(id) { document.getElementById(id).classList.remove('open'); }

async function checkAuth() {
  const token = localStorage.getItem('nav_token');
  if (!token) return false;
  try {
    const res = await fetch('/api/verify', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    return data.valid === true;
  } catch(e) { return false; }
}

async function saveNavConfig(newConfig) {
  const token = localStorage.getItem('nav_token');
  if (!token) {
    alert('请先登录管理后台');
    window.location.href = '/admin';
    return false;
  }
  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(newConfig)
    });
    const d = await res.json();
    if (d.ok) { CFG = newConfig; return true; }
    alert(d.error || '保存失败');
    return false;
  } catch(e) { alert('保存失败'); return false; }
}

async function boot() {
  isAuthed = await checkAuth();
  try {
    const res = await fetch('/api/config');
    CFG = await res.json();
  } catch(e) {
    CFG = { theme:'light', background:{type:'default'},
            engines:[{id:'google',name:'Google',url:'https://www.google.com/search?q='}],
            searchEngine:'google', quickLinks:[], categories:[], showAdminLink:true };
  }
  applyConfig();
  renderEngines();
  renderQuickLinks();
  renderCategories();
  if (isAuthed) {
    const addCatBtn = document.getElementById('nav-add-cat-btn');
    if (addCatBtn) addCatBtn.style.display = 'block';
  }
  document.getElementById('search-input').focus();
}

function applyConfig() {
  const theme = CFG.theme==='auto'
    ? (window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')
    : CFG.theme || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-btn').textContent = theme==='dark'?'☀':'🌙';

  const bg = CFG.background || {};
  const bgLayer = document.getElementById('bg-layer');
  const overlay = document.getElementById('bg-overlay');

  bgLayer.style.backgroundImage = '';
  bgLayer.style.background = '';
  bgLayer.classList.remove('blur-bg');

  switch(bg.type) {
    case 'color':
    case 'gradient':
      document.body.style.background = bg.value || 'var(--bg)';
      bgLayer.style.opacity = '0';
      break;
    case 'upload':
      bgLayer.style.backgroundImage = 'url(/api/bg)';
      bgLayer.style.opacity = '1';
      document.body.style.background = '';
      if(bg.blur) bgLayer.classList.add('blur-bg');
      break;
    case 'url':
      bgLayer.style.backgroundImage = 'url(' + bg.value + ')';
      bgLayer.style.opacity = '1';
      document.body.style.background = '';
      if(bg.blur) bgLayer.classList.add('blur-bg');
      break;
    default:
      bgLayer.style.opacity = '0';
      document.body.style.background = '';
  }
  if(bg.overlay > 0) {
    overlay.style.background = 'rgba(0,0,0,' + bg.overlay + ')';
  } else {
    overlay.style.background = 'transparent';
  }

  const adminLink = document.getElementById('admin-link');
  if(adminLink) adminLink.style.display = CFG.showAdminLink===false?'none':'grid';

  if(CFG.siteTitle) document.title = CFG.siteTitle;
  activeEngine = CFG.searchEngine || (CFG.engines && CFG.engines[0] ? CFG.engines[0].id : 'google');
}

document.getElementById('theme-btn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('theme-btn').textContent = next==='dark'?'☀':'🌙';
});

function renderEngines() {
  const pills = document.getElementById('engine-pills');
  pills.innerHTML = (CFG.engines||[]).map(e =>
    '<button class="engine-pill' + (e.id===activeEngine?' active':'') + '" data-id="' + e.id + '">' + e.name + '</button>'
  ).join('');
  pills.querySelectorAll('.engine-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeEngine = btn.dataset.id;
      pills.querySelectorAll('.engine-pill').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function doSearch(q) {
  q = q.trim();
  if(!q) return;
  if(/^https?:\\/\\//.test(q) || (/^[\\w-]+\\.[\\w.-]+(\\/)?(\\S*)$/.test(q)&&!q.includes(' '))) {
    window.location.href = q.startsWith('http') ? q : 'https://'+q;
  } else {
    const eng = (CFG.engines||[]).find(e=>e.id===activeEngine);
    const url  = eng ? eng.url : 'https://www.google.com/search?q=';
    window.open(url + encodeURIComponent(q), '_blank');
  }
}
document.getElementById('search-btn').addEventListener('click', () =>
  doSearch(document.getElementById('search-input').value));
document.getElementById('search-input').addEventListener('keydown', e => {
  if(e.key==='Enter') doSearch(e.target.value);
});
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){
    e.preventDefault();
    document.getElementById('search-input').focus();
    document.getElementById('search-input').select();
  }
});

function renderQuickLinks() {
  const ql = CFG.quickLinks || [];
  const section = document.getElementById('quick-section');
  if(!ql.length && !isAuthed){ section.style.display='none'; return; }
  section.style.display='';
  let html = ql.map(function(q, idx) {
    return '<a class="quick-link glass" href="' + q.url + '" target="_blank" rel="noopener">' +
      (isAuthed ? '<button class="item-del-btn" onclick="event.preventDefault();deleteQuickLink(' + idx + ')" title="删除">✕</button>' : '') +
      '<div class="quick-icon">' + iconHtml(q) + '</div>' +
      '<div class="quick-name">' + q.name + '</div>' +
    '</a>';
  }).join('');

  if (isAuthed) {
    html += '<div class="quick-link add-link-btn glass" onclick="openNavModal(\\'nav-quick-modal\\')">' +
      '<div class="quick-icon">＋</div>' +
      '<div class="quick-name">添加</div>' +
    '</div>';
  }
  document.getElementById('quick-grid').innerHTML = html;
}

window.deleteQuickLink = async function(idx) {
  if (!confirm('确认删除此快捷方式？')) return;
  CFG.quickLinks.splice(idx, 1);
  if (await saveNavConfig(CFG)) renderQuickLinks();
};

document.getElementById('nq-submit').addEventListener('click', async () => {
  const name = document.getElementById('nq-name').value.trim();
  let url = document.getElementById('nq-url').value.trim();
  if (!name || !url) return alert('请填写名称和网址');
  if (!/^https?:\\/\\//i.test(url)) url = 'https://' + url;
  CFG.quickLinks = CFG.quickLinks || [];
  CFG.quickLinks.push({ id: 'q_' + Date.now(), name, url });
  if (await saveNavConfig(CFG)) {
    closeNavModal('nav-quick-modal');
    document.getElementById('nq-name').value = '';
    document.getElementById('nq-url').value = '';
    renderQuickLinks();
  }
});

function renderCategories() {
  const cats = CFG.categories || [];
  const el = document.getElementById('categories');
  el.innerHTML = cats.map(function(cat, cIdx) {
    const sitesHtml = (cat.sites||[]).map(function(s, sIdx) {
      return '<a class="site-card glass" href="' + s.url + '" target="_blank" rel="noopener">' +
        (isAuthed ? '<button class="item-del-btn" onclick="event.preventDefault();deleteSite(' + cIdx + ',' + sIdx + ')" title="删除">✕</button>' : '') +
        '<div class="site-icon">' + iconHtml(s) + '</div>' +
        '<div class="site-info">' +
          '<div class="site-name">' + s.name + '</div>' +
          (s.desc?'<div class="site-desc">' + s.desc + '</div>':'') +
        '</div>' +
        '<span class="site-arrow">›</span>' +
      '</a>';
    }).join('');

    return '<div class="cat-section">' +
      '<div class="cat-title">' +
        (cat.icon||'') + ' ' + cat.name +
        (isAuthed ? '<button class="cat-add-btn" title="在该分类下添加网址" onclick="openAddSiteFor(\\'' + cat.id + '\\')">＋</button>' : '') +
      '</div>' +
      '<div class="site-grid">' + sitesHtml + '</div>' +
    '</div>';
  }).join('');
}

window.openAddSiteFor = function(catId) {
  currentTargetCatId = catId;
  openNavModal('nav-site-modal');
};

window.deleteSite = async function(cIdx, sIdx) {
  if (!confirm('确认删除该书签？')) return;
  CFG.categories[cIdx].sites.splice(sIdx, 1);
  if (await saveNavConfig(CFG)) renderCategories();
};

document.getElementById('ns-submit').addEventListener('click', async () => {
  const name = document.getElementById('ns-name').value.trim();
  let url = document.getElementById('ns-url').value.trim();
  const desc = document.getElementById('ns-desc').value.trim();
  if (!name || !url) return alert('请填写名称和网址');
  if (!/^https?:\\/\\//i.test(url)) url = 'https://' + url;

  const targetCat = (CFG.categories || []).find(c => c.id === currentTargetCatId);
  if (!targetCat) return;
  targetCat.sites = targetCat.sites || [];
  targetCat.sites.push({ id: 's_' + Date.now(), name, url, desc });

  if (await saveNavConfig(CFG)) {
    closeNavModal('nav-site-modal');
    document.getElementById('ns-name').value = '';
    document.getElementById('ns-url').value = '';
    document.getElementById('ns-desc').value = '';
    renderCategories();
  }
});

document.getElementById('nav-add-cat-btn').addEventListener('click', () => {
  openNavModal('nav-cat-modal');
});

document.getElementById('nc-submit').addEventListener('click', async () => {
  const name = document.getElementById('nc-name').value.trim();
  const icon = document.getElementById('nc-icon').value.trim() || '📁';
  if (!name) return alert('请填写分类名称');

  CFG.categories = CFG.categories || [];
  CFG.categories.push({ id: 'c_' + Date.now(), name, icon, sites: [] });

  if (await saveNavConfig(CFG)) {
    closeNavModal('nav-cat-modal');
    document.getElementById('nc-name').value = '';
    renderCategories();
  }
});

boot();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────
// 8. ADMIN PAGE HTML
// ─────────────────────────────────────────────────────────

function adminPageHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>cf-nav 管理后台</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;-webkit-font-smoothing:antialiased}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;
  background:#f5f5f7;color:#1d1d1f;font-size:14px;
}
:root{
  --accent:#007aff;--accent-h:#0055b3;
  --surface:#fff;--bg:#f5f5f7;--border:#e5e5ea;
  --text:#1d1d1f;--muted:#6e6e73;
  --red:#ff3b30;--green:#30d158;--orange:#ff9500;
  --radius:12px;--radius-sm:8px;
}
.auth-wrap{
  min-height:100vh;display:grid;place-items:center;
  background:linear-gradient(135deg,#f0f4ff 0%,#faf5ff 100%);
}
.auth-card{
  background:#fff;border-radius:20px;padding:48px 40px;
  width:min(420px,95vw);box-shadow:0 8px 48px rgba(0,0,0,.1);
}
.auth-logo{font-size:2.5rem;text-align:center;margin-bottom:8px}
.auth-title{font-size:1.4rem;font-weight:700;text-align:center;margin-bottom:4px}
.auth-subtitle{font-size:.85rem;color:var(--muted);text-align:center;margin-bottom:32px}
.form-group{margin-bottom:16px}
.form-label{font-size:.8rem;font-weight:600;color:var(--muted);margin-bottom:6px;display:block}
.form-input{
  width:100%;padding:11px 14px;border-radius:var(--radius-sm);
  border:1.5px solid var(--border);background:#f5f5f7;
  color:var(--text);font-size:.95rem;outline:none;transition:border .2s;font-family:inherit;
}
.form-input:focus{border-color:var(--accent);background:#fff}
.form-select{
  width:100%;padding:10px 14px;border-radius:var(--radius-sm);
  border:1.5px solid var(--border);background:#f5f5f7;
  color:var(--text);font-size:.88rem;outline:none;
  transition:border .2s;font-family:inherit;cursor:pointer;
}
.form-select:focus{border-color:var(--accent);background:#fff}
.btn{
  width:100%;padding:13px;border-radius:var(--radius-sm);
  border:none;background:var(--accent);color:#fff;
  font-size:.95rem;font-weight:600;cursor:pointer;
  transition:all .2s;font-family:inherit;
}
.btn:hover{background:var(--accent-h);transform:translateY(-1px)}
.btn.btn-sm{width:auto;padding:7px 16px;font-size:.82rem}
.btn.btn-ghost{background:transparent;border:1.5px solid var(--border);color:var(--muted)}
.btn.btn-ghost:hover{border-color:var(--accent);color:var(--accent);transform:none}
.btn.btn-danger{background:var(--red)}
.btn.btn-danger:hover{background:#c0392b}
.err-msg{
  padding:10px 14px;border-radius:var(--radius-sm);
  background:#fff0f0;border:1px solid #ffd0d0;
  color:var(--red);font-size:.83rem;margin-bottom:14px;display:none;
}
.err-msg.show{display:block}
.auth-switch{text-align:center;margin-top:16px;font-size:.82rem;color:var(--muted)}
.auth-switch a{color:var(--accent);text-decoration:none;cursor:pointer}
#dashboard{display:none;height:100vh;flex-direction:column}
#dashboard.visible{display:flex}
.dash-header{
  height:52px;background:rgba(255,255,255,.88);
  backdrop-filter:blur(20px);border-bottom:1px solid var(--border);
  display:flex;align-items:center;padding:0 20px;gap:12px;
  position:sticky;top:0;z-index:100;flex-shrink:0;
}
.dash-logo{font-size:1.1rem;font-weight:700;color:var(--text)}
.dash-logo span{color:var(--accent)}
.dash-user{margin-left:auto;font-size:.82rem;color:var(--muted)}
.btn-logout{
  padding:6px 14px;border-radius:999px;border:1.5px solid var(--border);
  background:transparent;color:var(--muted);cursor:pointer;font-size:.78rem;
  transition:all .2s;font-family:inherit;
}
.btn-logout:hover{border-color:var(--red);color:var(--red)}
.dash-body{display:flex;flex:1;overflow:hidden}
.sidebar{
  width:200px;flex-shrink:0;background:var(--surface);
  border-right:1px solid var(--border);
  padding:16px 10px;display:flex;flex-direction:column;gap:4px;
  overflow-y:auto;
}
.nav-btn{
  display:flex;align-items:center;gap:10px;
  padding:10px 14px;border-radius:var(--radius-sm);
  border:none;background:transparent;color:var(--muted);
  font-size:.88rem;font-weight:500;cursor:pointer;
  transition:all .2s;text-align:left;width:100%;font-family:inherit;
}
.nav-btn:hover{background:#f0f0f5;color:var(--text)}
.nav-btn.active{background:#e8f0ff;color:var(--accent);font-weight:600}
.nav-btn .nav-icon{font-size:1rem;width:20px;text-align:center;flex-shrink:0}
.main-content{flex:1;overflow-y:auto;padding:28px 32px}
.main-content .section-panel{display:none}
.main-content .section-panel.active{display:block}
.panel-header{margin-bottom:24px}
.panel-title{font-size:1.3rem;font-weight:700}
.panel-desc{font-size:.83rem;color:var(--muted);margin-top:4px}
.card{
  background:var(--surface);border-radius:var(--radius);
  border:1px solid var(--border);padding:20px;margin-bottom:16px;
}
.card-title{font-size:.85rem;font-weight:700;color:var(--muted);
  letter-spacing:.8px;text-transform:uppercase;margin-bottom:14px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-group-inline{display:flex;align-items:center;gap:10px}
.form-hint{font-size:.75rem;color:var(--muted);margin-top:4px}
.bg-type-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.bg-tab{
  padding:6px 14px;border-radius:999px;border:1.5px solid var(--border);
  background:transparent;color:var(--muted);font-size:.78rem;font-weight:600;
  cursor:pointer;transition:all .2s;font-family:inherit;
}
.bg-tab.active{background:var(--accent);border-color:var(--accent);color:#fff}
.bg-panel{display:none}
.bg-panel.active{display:block}
.upload-zone{
  border:2px dashed var(--border);border-radius:var(--radius-sm);
  padding:28px;text-align:center;cursor:pointer;
  transition:all .2s;background:var(--bg);position:relative;
}
.upload-zone:hover,.upload-zone.drag-over{
  border-color:var(--accent);background:#f0f7ff;
}
.upload-zone input[type=file]{
  position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;
}
.upload-zone .uz-icon{font-size:2rem;margin-bottom:8px}
.upload-zone .uz-text{font-size:.85rem;color:var(--muted)}
.upload-zone .uz-hint{font-size:.73rem;color:var(--muted);margin-top:4px}
.upload-preview{
  max-width:100%;border-radius:var(--radius-sm);margin-top:12px;
  display:none;max-height:160px;object-fit:cover;width:100%;
}
.item-list{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.item-row{
  display:flex;align-items:center;gap:10px;
  padding:10px 14px;border-radius:var(--radius-sm);
  background:var(--bg);border:1px solid var(--border);
}
.item-icon{
  width:32px;height:32px;border-radius:7px;
  display:grid;place-items:center;font-size:1rem;
  flex-shrink:0;overflow:hidden;background:var(--surface);
}
.item-icon img{width:24px;height:24px;object-fit:contain;border-radius:3px}
.item-info{flex:1;min-width:0}
.item-name{font-size:.88rem;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item-url{font-size:.72rem;color:var(--muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item-actions{display:flex;gap:6px;flex-shrink:0}
.icon-btn{
  width:28px;height:28px;border-radius:6px;border:none;
  background:transparent;cursor:pointer;font-size:.85rem;
  display:grid;place-items:center;transition:background .2s;color:var(--muted);
}
.icon-btn:hover{background:var(--border);color:var(--text)}
.icon-btn.del:hover{background:#fff0f0;color:var(--red)}
.cat-block{margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}
.cat-header{
  display:flex;align-items:center;gap:10px;padding:12px 14px;
  background:var(--surface);cursor:pointer;user-select:none;
}
.cat-header:hover{background:var(--bg)}
.cat-chevron{margin-left:auto;transition:transform .2s;font-size:.7rem;color:var(--muted)}
.cat-block.open .cat-chevron{transform:rotate(180deg)}
.cat-sites{display:none;padding:8px 14px 12px;background:var(--bg)}
.cat-block.open .cat-sites{display:block}
.modal-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.45);
  backdrop-filter:blur(4px);z-index:200;
  display:none;place-items:center;
}
.modal-overlay.open{display:grid}
.modal{
  background:var(--surface);border-radius:20px;
  padding:28px;width:min(500px,95vw);
  max-height:90vh;overflow-y:auto;
  box-shadow:0 20px 60px rgba(0,0,0,.15);
  animation:slideUp .25s ease;
}
@keyframes slideUp{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
.modal-title{font-size:1.1rem;font-weight:700;margin-bottom:20px}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
.icon-upload-area{
  display:flex;align-items:center;gap:12px;margin-bottom:6px;
}
.icon-preview-box{
  width:56px;height:56px;border-radius:12px;
  background:var(--bg);border:1.5px solid var(--border);
  display:grid;place-items:center;font-size:1.8rem;
  flex-shrink:0;overflow:hidden;position:relative;cursor:pointer;
  transition:border-color .2s;
}
.icon-preview-box:hover{border-color:var(--accent)}
.icon-preview-box input[type=file]{
  position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;
}
.icon-preview-box img{width:100%;height:100%;object-fit:contain;border-radius:10px;padding:6px}
input[type=color]{
  width:48px;height:36px;border-radius:var(--radius-sm);
  border:1.5px solid var(--border);cursor:pointer;padding:2px;
  background:transparent;
}
.toast{
  position:fixed;bottom:24px;right:24px;z-index:300;
  background:#1d1d1f;color:#fff;padding:12px 20px;
  border-radius:var(--radius-sm);font-size:.85rem;
  transform:translateY(80px);opacity:0;transition:all .3s;
  pointer-events:none;
}
.toast.show{transform:translateY(0);opacity:1}
@media(max-width:700px){
  .sidebar{display:none}
  .main-content{padding:16px}
  .form-row{grid-template-columns:1fr}
}
</style>
</head>
<body>

<!-- Auth: Setup -->
<div class="auth-wrap" id="screen-setup" style="display:none">
  <div class="auth-card">
    <div class="auth-logo">🏠</div>
    <div class="auth-title">初始化管理后台</div>
    <div class="auth-subtitle">首次使用，请创建管理员账户</div>
    <div class="err-msg" id="setup-err"></div>
    <div class="form-group">
      <label class="form-label">用户名</label>
      <input class="form-input" id="setup-username" type="text" placeholder="admin" autocomplete="username"/>
    </div>
    <div class="form-group">
      <label class="form-label">密码</label>
      <input class="form-input" id="setup-password" type="password" placeholder="设置一个强密码" autocomplete="new-password"/>
    </div>
    <div id="invite-field-setup" class="form-group" style="display:none">
      <label class="form-label">邀请码</label>
      <input class="form-input" id="setup-invite" type="text" placeholder="请输入邀请码"/>
    </div>
    <button class="btn" id="setup-btn">创建账户</button>
  </div>
</div>

<!-- Auth: Login -->
<div class="auth-wrap" id="screen-login" style="display:none">
  <div class="auth-card">
    <div class="auth-logo">🏠</div>
    <div class="auth-title">管理后台登录</div>
    <div class="auth-subtitle">cf-nav · 个人导航</div>
    <div class="err-msg" id="login-err"></div>
    <div class="form-group">
      <label class="form-label">用户名</label>
      <input class="form-input" id="login-username" type="text" autocomplete="username" placeholder=""/>
    </div>
    <div class="form-group">
      <label class="form-label">密码</label>
      <input class="form-input" id="login-password" type="password" autocomplete="current-password"/>
    </div>
    <button class="btn" id="login-btn">登录</button>
    <div class="auth-switch" id="register-link" style="display:none">
      <a id="go-register">→ 注册新账户</a>
    </div>
  </div>
</div>

<!-- Dashboard -->
<div id="dashboard">
  <div class="dash-header">
    <div class="dash-logo">cf<span>-nav</span></div>
    <span style="font-size:.7rem;color:var(--muted);margin-left:4px">管理后台</span>
    <a href="/" target="_blank" style="margin-left:8px;font-size:.78rem;color:var(--accent);text-decoration:none">↗ 查看导航页</a>
    <div class="dash-user" id="dash-username"></div>
    <button class="btn-logout" id="logout-btn">退出登录</button>
  </div>
  <div class="dash-body">
    <aside class="sidebar">
      <button class="nav-btn active" data-section="appearance"><span class="nav-icon">🎨</span>外观</button>
      <button class="nav-btn" data-section="quicklinks"><span class="nav-icon">⚡</span>快速访问</button>
      <button class="nav-btn" data-section="categories"><span class="nav-icon">📂</span>分类导航</button>
      <button class="nav-btn" data-section="settings"><span class="nav-icon">⚙️</span>系统设置</button>
    </aside>
    <div class="main-content">

      <!-- Appearance -->
      <div class="section-panel active" id="section-appearance">
        <div class="panel-header">
          <div class="panel-title">🎨 外观设置</div>
          <div class="panel-desc">自定义导航页的视觉风格与搜索引擎</div>
        </div>

        <div class="card">
          <div class="card-title">🖼 背景设置</div>
          <div class="bg-type-tabs">
            <button class="bg-tab active" data-type="default">默认</button>
            <button class="bg-tab" data-type="color">纯色</button>
            <button class="bg-tab" data-type="gradient">渐变</button>
            <button class="bg-tab" data-type="upload">上传图片</button>
            <button class="bg-tab" data-type="url">图片URL</button>
          </div>
          <div class="bg-panel active" id="bg-default">
            <p class="form-hint">使用系统默认背景（浅灰色 / 跟随主题）</p>
          </div>
          <div class="bg-panel" id="bg-color">
            <div class="form-group-inline">
              <label class="form-label" style="margin-bottom:0">背景颜色</label>
              <input type="color" id="bg-color-val" value="#f5f5f7"/>
            </div>
          </div>
          <div class="bg-panel" id="bg-gradient">
            <div class="form-group">
              <label class="form-label">渐变 CSS（linear-gradient / radial-gradient）</label>
              <input class="form-input" id="bg-gradient-val" placeholder="linear-gradient(135deg,#667eea,#764ba2)"/>
            </div>
          </div>
          <div class="bg-panel" id="bg-upload">
            <div class="upload-zone" id="bg-upload-zone">
              <input type="file" id="bg-file-input" accept="image/*"/>
              <div class="uz-icon">🖼️</div>
              <div class="uz-text">拖拽图片到此处，或点击选择</div>
              <div class="uz-hint">支持 JPG / PNG / WebP，最大 5MB</div>
            </div>
            <img id="bg-preview" class="upload-preview" alt="背景预览"/>
          </div>
          <div class="bg-panel" id="bg-url">
            <div class="form-group">
              <label class="form-label">图片 URL</label>
              <input class="form-input" id="bg-url-val" placeholder="https://example.com/image.jpg"/>
            </div>
          </div>
          <div style="margin-top:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <label class="form-group-inline" style="cursor:pointer">
              <input type="checkbox" id="bg-blur"/>
              <span style="margin-left:6px;font-size:.85rem">背景模糊</span>
            </label>
            <div class="form-group-inline">
              <label class="form-label" style="margin-bottom:0;font-size:.82rem">遮罩透明度</label>
              <input type="range" id="bg-overlay" min="0" max="0.8" step="0.05" value="0" style="width:100px"/>
              <span id="bg-overlay-val" style="font-size:.8rem;color:var(--muted)">0%</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">🌗 主题 & 显示</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">主题模式</label>
              <select class="form-select" id="theme-select">
                <option value="light">☀️ 浅色</option>
                <option value="dark">🌙 深色</option>
                <option value="auto">💻 跟随系统</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">站点标题</label>
              <input class="form-input" id="site-title" placeholder="我的导航"/>
            </div>
          </div>
          <label class="form-group-inline" style="cursor:pointer;margin-top:4px">
            <input type="checkbox" id="show-admin-link" checked/>
            <span style="margin-left:8px;font-size:.85rem">在导航页显示管理入口</span>
          </label>
        </div>

        <!-- 🔍 搜索引擎管理 -->
        <div class="card">
          <div class="card-title">🔍 搜索引擎管理</div>
          <div class="form-group">
            <label class="form-label">默认搜索引擎</label>
            <select class="form-select" id="default-engine"></select>
          </div>
          <div class="form-label" style="margin-top:14px">已有引擎列表</div>
          <div class="item-list" id="engine-list"></div>
          <button class="btn btn-ghost btn-sm" id="add-engine">+ 添加搜索引擎</button>
        </div>

        <button class="btn" id="save-appearance">保存外观设置</button>
      </div>

      <!-- Quick Links -->
      <div class="section-panel" id="section-quicklinks">
        <div class="panel-header">
          <div class="panel-title">⚡ 快速访问</div>
          <div class="panel-desc">管理顶部快速访问图标（图标自动从网址获取）</div>
        </div>
        <div class="card">
          <div class="item-list" id="quick-list"></div>
          <button class="btn btn-ghost btn-sm" id="add-quick">+ 添加快速访问</button>
        </div>
      </div>

      <!-- Categories -->
      <div class="section-panel" id="section-categories">
        <div class="panel-header">
          <div class="panel-title">📂 分类导航</div>
          <div class="panel-desc">管理分类和书签网站（图标自动从网址获取）</div>
        </div>
        <div id="cat-list"></div>
        <button class="btn btn-ghost btn-sm" id="add-cat">+ 添加分类</button>
      </div>

      <!-- Settings -->
      <div class="section-panel" id="section-settings">
        <div class="panel-header">
          <div class="panel-title">⚙️ 系统设置</div>
          <div class="panel-desc">账户、注册权限、数据管理</div>
        </div>

        <div class="card">
          <div class="card-title">🔐 修改密码</div>
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input class="form-input" id="new-password" type="password" placeholder="留空则不修改"/>
          </div>
          <button class="btn btn-sm" id="save-password">更新密码</button>
        </div>

        <div class="card">
          <div class="card-title">👥 注册权限</div>
          <div class="form-group">
            <label class="form-label">注册模式</label>
            <select class="form-select" id="reg-mode">
              <option value="closed">🔒 仅自己（关闭注册）</option>
              <option value="invite">🎟 邀请码注册</option>
              <option value="open">🌐 开放注册</option>
            </select>
          </div>
          <div class="form-group" id="invite-code-field" style="display:none">
            <label class="form-label">邀请码</label>
            <div class="form-group-inline">
              <input class="form-input" id="invite-code" placeholder="设置邀请码"/>
              <button class="btn btn-ghost btn-sm" id="gen-invite">随机生成</button>
            </div>
          </div>
          <button class="btn btn-sm" id="save-reg">保存注册设置</button>
        </div>

        <div class="card">
          <div class="card-title">💾 数据管理</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" id="export-btn">📤 导出配置</button>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">
              📥 导入配置
              <input type="file" id="import-file" accept=".json" style="display:none"/>
            </label>
            <button class="btn btn-danger btn-sm" id="reset-btn">⚠️ 重置为默认</button>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>

<!-- Modal: Engine -->
<div class="modal-overlay" id="engine-modal">
  <div class="modal">
    <div class="modal-title" id="engine-modal-title">添加搜索引擎</div>
    <div class="form-group">
      <label class="form-label">标识 ID（英文字母，如 duckduckgo）*</label>
      <input class="form-input" id="engine-id" placeholder="如：ddg"/>
    </div>
    <div class="form-group">
      <label class="form-label">名称 *</label>
      <input class="form-input" id="engine-name" placeholder="如：DuckDuckGo"/>
    </div>
    <div class="form-group">
      <label class="form-label">搜索 URL 前缀 *</label>
      <input class="form-input" id="engine-url" placeholder="如：https://duckduckgo.com/?q="/>
      <div class="form-hint">搜索关键词将直接拼接在 URL 末尾</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('engine-modal')">取消</button>
      <button class="btn btn-sm" id="engine-modal-save">保存</button>
    </div>
  </div>
</div>

<!-- Modal: Site -->
<div class="modal-overlay" id="site-modal">
  <div class="modal">
    <div class="modal-title" id="site-modal-title">添加网站</div>
    <div class="form-group">
      <label class="form-label">自定义图标（可选，留空则自动获取网站图标）</label>
      <div class="icon-upload-area">
        <div class="icon-preview-box" id="site-icon-preview">
          <input type="file" id="site-icon-file" accept="image/*"/>
          <span id="site-icon-display">🌐</span>
        </div>
        <div class="icon-input-wrap">
          <input class="form-input" id="site-icon-text" placeholder="留空自动获取，或输入图片URL"/>
          <div class="form-hint">也可点击左侧方框上传自定义图标</div>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">网站名称 *</label>
      <input class="form-input" id="site-name" placeholder="例如：GitHub"/>
    </div>
    <div class="form-group">
      <label class="form-label">网址 URL *</label>
      <input class="form-input" id="site-url" placeholder="https://github.com"/>
    </div>
    <div class="form-group">
      <label class="form-label">简介描述</label>
      <input class="form-input" id="site-desc" placeholder="代码托管平台"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" id="site-modal-cancel">取消</button>
      <button class="btn btn-sm" id="site-modal-save">保存</button>
    </div>
  </div>
</div>

<!-- Modal: Quick Link -->
<div class="modal-overlay" id="quick-modal">
  <div class="modal">
    <div class="modal-title" id="quick-modal-title">添加快速访问</div>
    <div class="form-group">
      <label class="form-label">自定义图标（可选，留空则自动获取网站图标）</label>
      <div class="icon-upload-area">
        <div class="icon-preview-box" id="quick-icon-preview">
          <input type="file" id="quick-icon-file" accept="image/*"/>
          <span id="quick-icon-display">🌐</span>
        </div>
        <div class="icon-input-wrap">
          <input class="form-input" id="quick-icon-text" placeholder="留空自动获取，或输入图片URL"/>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">名称 *</label>
      <input class="form-input" id="quick-name-input" placeholder="GitHub"/>
    </div>
    <div class="form-group">
      <label class="form-label">URL *</label>
      <input class="form-input" id="quick-url-input" placeholder="https://github.com"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" id="quick-modal-cancel">取消</button>
      <button class="btn btn-sm" id="quick-modal-save">保存</button>
    </div>
  </div>
</div>

<!-- Modal: Category -->
<div class="modal-overlay" id="cat-modal">
  <div class="modal">
    <div class="modal-title" id="cat-modal-title">添加分类</div>
    <div class="form-group">
      <label class="form-label">图标 Emoji</label>
      <input class="form-input" id="cat-icon" placeholder="📁"/>
    </div>
    <div class="form-group">
      <label class="form-label">分类名称 *</label>
      <input class="form-input" id="cat-name" placeholder="工具网站"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" id="cat-modal-cancel">取消</button>
      <button class="btn btn-sm" id="cat-modal-save">保存</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let TOKEN = localStorage.getItem('nav_token') || '';
let CFG   = null;
let REG   = { mode:'closed', inviteCode:'' };
let editingQuickIdx  = -1;
let editingSiteRef   = null;
let editingCatIdx    = -1;
let editingEngineIdx = -1;
let pendingSiteIcon  = '';
let pendingQuickIcon = '';
let pendingBgDataUrl = '';

function faviconUrl(siteUrl) {
  try {
    const host = new URL(siteUrl).hostname;
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64';
  } catch(e) { return ''; }
}

function itemIconHtml(item) {
  const ico = (item.icon || '').trim();
  if (ico.startsWith('data:')) return '<img src="' + ico + '" alt=""/>';
  const fav = faviconUrl(item.url || '');
  return fav ? '<img src="' + fav + '" loading="lazy" onerror="this.style.opacity=\\'0\\'" alt=""/>' : '🔗';
}

function uid() { return Math.random().toString(36).slice(2,10); }
function toast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type==='err'?'#ff3b30':'#1d1d1f';
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(()=>t.classList.remove('show'), 2600);
}
function api(path, opts={}) {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + TOKEN, ...(opts.headers||{}) },
  }).then(r => r.json());
}
function showModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showErr(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg; el.classList.add('show');
}
function clearErr(elId) { document.getElementById(elId).classList.remove('show'); }

async function boot() {
  const status = await fetch('/api/status').then(r=>r.json()).catch(()=>({initialized:false}));
  REG.mode = status.registerMode || 'closed';
  if(!status.initialized) {
    showSetup(false, status);
    return;
  }
  if(TOKEN) {
    try {
      const v = await api('/api/verify');
      if(v.valid) { showDashboard(v.username); return; }
    } catch(e) {}
    TOKEN = ''; localStorage.removeItem('nav_token');
  }
  showLogin(status);
}

function showSetup(isAdditional, status) {
  document.getElementById('screen-setup').style.display = '';
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('dashboard').classList.remove('visible');
  if(isAdditional && status?.requireInvite) {
    document.getElementById('invite-field-setup').style.display = '';
  }
}
function showLogin(status) {
  document.getElementById('screen-setup').style.display = 'none';
  document.getElementById('screen-login').style.display = '';
  document.getElementById('dashboard').classList.remove('visible');
  const rl = document.getElementById('register-link');
  if(status && status.registerMode !== 'closed') rl.style.display='';
  else rl.style.display='none';
}
async function showDashboard(username) {
  document.getElementById('screen-setup').style.display = 'none';
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('dash-username').textContent = username || '';
  await loadConfig();
  await loadRegConfig();
  renderAll();
}

document.getElementById('setup-btn').addEventListener('click', async () => {
  clearErr('setup-err');
  const u = document.getElementById('setup-username').value.trim();
  const p = document.getElementById('setup-password').value;
  const inv = document.getElementById('setup-invite').value.trim();
  if(!u||!p){ showErr('setup-err','请填写用户名和密码'); return; }
  const res = await api('/api/setup', {
    method:'POST', body: JSON.stringify({ username:u, password:p, inviteCode:inv })
  });
  if(res.error){ showErr('setup-err', res.error); return; }
  TOKEN = res.token; localStorage.setItem('nav_token', TOKEN);
  showDashboard(res.username);
});

document.getElementById('login-btn').addEventListener('click', async () => {
  clearErr('login-err');
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  if(!u||!p){ showErr('login-err','请输入用户名和密码'); return; }
  const res = await api('/api/login', { method:'POST', body: JSON.stringify({ username:u, password:p }) });
  if(res.error){ showErr('login-err', res.error); return; }
  TOKEN = res.token; localStorage.setItem('nav_token', TOKEN);
  showDashboard(res.username);
});
['login-username','login-password','setup-username','setup-password'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if(e.key==='Enter') document.getElementById(id.startsWith('login')?'login-btn':'setup-btn').click();
  });
});
document.getElementById('go-register').addEventListener('click', () => showSetup(true, {requireInvite: REG.mode==='invite'}));
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method:'POST' });
  TOKEN=''; localStorage.removeItem('nav_token');
  boot();
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.section-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('section-'+btn.dataset.section).classList.add('active');
  });
});

async function loadConfig() {
  try {
    const res = await api('/api/config');
    if(!res.error) CFG = res;
  } catch(e) {}
}
async function loadRegConfig() {
  try {
    const st = await fetch('/api/status').then(r=>r.json());
    REG.mode = st.registerMode || 'closed';
  } catch(e) {}
}
async function saveConfig(patch) {
  const toSave = { ...CFG, ...patch };
  const res = await api('/api/config', { method:'PUT', body: JSON.stringify(toSave) });
  if(res.ok) { CFG = toSave; toast('✓ 保存成功'); }
  else toast(res.error||'保存失败', 'err');
  return res.ok;
}

function renderAll() {
  renderAppearance();
  renderEnginesList();
  renderQuickList();
  renderCatList();
  renderSettings();
}

function renderAppearance() {
  if(!CFG) return;
  const bg = CFG.background || {};
  document.querySelectorAll('.bg-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.type === (bg.type||'default'));
  });
  document.querySelectorAll('.bg-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'bg-'+(bg.type||'default'));
  });
  if(bg.type==='color')    document.getElementById('bg-color-val').value  = bg.value||'#f5f5f7';
  if(bg.type==='gradient') document.getElementById('bg-gradient-val').value = bg.value||'';
  if(bg.type==='url')      document.getElementById('bg-url-val').value    = bg.value||'';
  if(bg.type==='upload')   {
    document.getElementById('bg-preview').src = bg._previewUrl||'/api/bg';
    document.getElementById('bg-preview').style.display='block';
  }
  document.getElementById('bg-blur').checked = bg.blur||false;
  document.getElementById('bg-overlay').value = bg.overlay||0;
  document.getElementById('bg-overlay-val').textContent = Math.round((bg.overlay||0)*100)+'%';
  document.getElementById('theme-select').value = CFG.theme||'light';
  document.getElementById('site-title').value   = CFG.siteTitle||'我的导航';
  document.getElementById('show-admin-link').checked = CFG.showAdminLink !== false;

  renderEngineSelect();
}

function renderEngineSelect() {
  const sel = document.getElementById('default-engine');
  const engines = CFG.engines || [];
  sel.innerHTML = engines.map(e =>
    '<option value="' + e.id + '"' + (e.id===(CFG.searchEngine||'google')?' selected':'') + '>' + e.name + '</option>'
  ).join('');
}

function renderEnginesList() {
  if(!CFG) return;
  const engines = CFG.engines || [];
  const list = document.getElementById('engine-list');
  list.innerHTML = engines.map((e, idx) =>
    '<div class="item-row">' +
      '<div class="item-info">' +
        '<div class="item-name">' + e.name + ' <span style="font-weight:normal;color:var(--muted);font-size:.78rem">(' + e.id + ')</span></div>' +
        '<div class="item-url">' + e.url + '</div>' +
      '</div>' +
      '<div class="item-actions">' +
        '<button class="icon-btn del" onclick="delEngine(' + idx + ')" title="删除">🗑</button>' +
      '</div>' +
    '</div>'
  ).join('');
  renderEngineSelect();
}

window.delEngine = async function(idx) {
  if((CFG.engines||[]).length <= 1) {
    toast('至少保留一个搜索引擎', 'err');
    return;
  }
  if(!confirm('确认删除该搜索引擎？')) return;
  CFG.engines.splice(idx, 1);
  if(!CFG.engines.find(e => e.id === CFG.searchEngine)) {
    CFG.searchEngine = CFG.engines[0].id;
  }
  await saveConfig({ engines: CFG.engines, searchEngine: CFG.searchEngine });
  renderEnginesList();
};

document.getElementById('add-engine').addEventListener('click', () => {
  document.getElementById('engine-id').value = '';
  document.getElementById('engine-name').value = '';
  document.getElementById('engine-url').value = '';
  showModal('engine-modal');
});

document.getElementById('engine-modal-save').addEventListener('click', async () => {
  const id = document.getElementById('engine-id').value.trim().toLowerCase();
  const name = document.getElementById('engine-name').value.trim();
  const url = document.getElementById('engine-url').value.trim();
  if(!id || !name || !url) {
    toast('请完整填写 ID、名称和 URL', 'err');
    return;
  }
  CFG.engines = CFG.engines || [];
  if(CFG.engines.some(e => e.id === id)) {
    toast('该标识 ID 已存在', 'err');
    return;
  }
  CFG.engines.push({ id, name, url });
  await saveConfig({ engines: CFG.engines });
  closeModal('engine-modal');
  renderEnginesList();
});

document.querySelectorAll('.bg-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bg-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.bg-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('bg-'+tab.dataset.type).classList.add('active');
    if(tab.dataset.type!=='upload') pendingBgDataUrl='';
  });
});

document.getElementById('bg-overlay').addEventListener('input', e => {
  document.getElementById('bg-overlay-val').textContent = Math.round(e.target.value*100)+'%';
});

setupUploadZone(
  document.getElementById('bg-upload-zone'),
  document.getElementById('bg-file-input'),
  5*1024*1024,
  async (dataUrl) => {
    pendingBgDataUrl = dataUrl;
    document.getElementById('bg-preview').src = dataUrl;
    document.getElementById('bg-preview').style.display = 'block';
    toast('图片已加载，保存后生效');
  }
);

document.getElementById('save-appearance').addEventListener('click', async () => {
  const theme      = document.getElementById('theme-select').value;
  const siteTitle  = document.getElementById('site-title').value.trim();
  const showAdminLink = document.getElementById('show-admin-link').checked;
  const searchEngine  = document.getElementById('default-engine').value;
  const blur    = document.getElementById('bg-blur').checked;
  const overlay = parseFloat(document.getElementById('bg-overlay').value);
  const activeTab = document.querySelector('.bg-tab.active')?.dataset.type || 'default';

  let bgValue = '';
  if(activeTab==='color')    bgValue = document.getElementById('bg-color-val').value;
  if(activeTab==='gradient') bgValue = document.getElementById('bg-gradient-val').value;
  if(activeTab==='url')      bgValue = document.getElementById('bg-url-val').value;

  if(activeTab==='upload' && pendingBgDataUrl) {
    const res = await api('/api/upload/bg', { method:'POST', body: JSON.stringify({ dataUrl: pendingBgDataUrl }) });
    if(!res.ok) { toast(res.error||'背景上传失败','err'); return; }
    pendingBgDataUrl = '';
  }

  await saveConfig({
    theme, siteTitle: siteTitle||'我的导航', showAdminLink, searchEngine,
    background: { type: activeTab, value: bgValue, blur, overlay },
  });
});

function renderQuickList() {
  if(!CFG) return;
  const list = document.getElementById('quick-list');
  list.innerHTML = (CFG.quickLinks||[]).map((q,i) =>
    '<div class="item-row">' +
      '<div class="item-icon">' + itemIconHtml(q) + '</div>' +
      '<div class="item-info">' +
        '<div class="item-name">' + q.name + '</div>' +
        '<div class="item-url">' + q.url + '</div>' +
      '</div>' +
      '<div class="item-actions">' +
        '<button class="icon-btn" onclick="editQuick(' + i + ')">✏️</button>' +
        '<button class="icon-btn del" onclick="delQuick(' + i + ')">🗑</button>' +
      '</div>' +
    '</div>'
  ).join('');
}
window.editQuick = function(i) {
  editingQuickIdx = i;
  pendingQuickIcon = '';
  const q = CFG.quickLinks[i];
  document.getElementById('quick-modal-title').textContent = '编辑快速访问';
  document.getElementById('quick-name-input').value = q.name||'';
  document.getElementById('quick-url-input').value  = q.url||'';
  document.getElementById('quick-icon-text').value  = '';
  updateIconPreview('quick', q.icon||'', q.url);
  showModal('quick-modal');
};
document.getElementById('add-quick').addEventListener('click', () => {
  editingQuickIdx = -1;
  pendingQuickIcon = '';
  document.getElementById('quick-modal-title').textContent = '添加快速访问';
  document.getElementById('quick-name-input').value = '';
  document.getElementById('quick-url-input').value  = '';
  document.getElementById('quick-icon-text').value  = '';
  updateIconPreview('quick', '', '');
  showModal('quick-modal');
});
window.delQuick = async function(i) {
  CFG.quickLinks.splice(i,1);
  renderQuickList();
  await saveConfig({ quickLinks: CFG.quickLinks });
};
document.getElementById('quick-modal-cancel').addEventListener('click',()=>closeModal('quick-modal'));
document.getElementById('quick-modal').addEventListener('click',e=>{if(e.target.id==='quick-modal')closeModal('quick-modal')});
document.getElementById('quick-modal-save').addEventListener('click', async () => {
  const name = document.getElementById('quick-name-input').value.trim();
  const url  = document.getElementById('quick-url-input').value.trim();
  const iconText = document.getElementById('quick-icon-text').value.trim();
  if(!name||!url){ toast('名称和URL不能为空','err'); return; }
  const icon = pendingQuickIcon || iconText || '';
  const entry = { id: editingQuickIdx>=0?(CFG.quickLinks[editingQuickIdx].id||uid()):uid(), name, url: fixUrl(url), icon };
  if(editingQuickIdx>=0) CFG.quickLinks[editingQuickIdx]=entry;
  else CFG.quickLinks.push(entry);
  renderQuickList();
  await saveConfig({ quickLinks: CFG.quickLinks });
  closeModal('quick-modal');
});

document.getElementById('quick-url-input').addEventListener('input', e => {
  if(!pendingQuickIcon && !document.getElementById('quick-icon-text').value) {
    updateIconPreview('quick', '', e.target.value);
  }
});

function renderCatList() {
  if(!CFG) return;
  const el = document.getElementById('cat-list');
  el.innerHTML = (CFG.categories||[]).map((cat,ci) => {
    const sitesHtml = (cat.sites||[]).map((s,si) =>
      '<div class="item-row">' +
        '<div class="item-icon">' + itemIconHtml(s) + '</div>' +
        '<div class="item-info">' +
          '<div class="item-name">' + s.name + '</div>' +
          '<div class="item-url">' + s.url + '</div>' +
        '</div>' +
        '<div class="item-actions">' +
          '<button class="icon-btn" onclick="editSite(' + ci + ',' + si + ')">✏️</button>' +
          '<button class="icon-btn del" onclick="delSite(' + ci + ',' + si + ')">🗑</button>' +
        '</div>' +
      '</div>'
    ).join('');

    return '<div class="cat-block" id="cat-block-' + ci + '">' +
      '<div class="cat-header" onclick="toggleCat(' + ci + ')">' +
        '<span style="font-size:1.2rem">' + (cat.icon||'📁') + '</span>' +
        '<span style="font-weight:600">' + cat.name + '</span>' +
        '<span style="font-size:.78rem;color:var(--muted);margin-left:4px">(' + (cat.sites||[]).length + ')</span>' +
        '<div style="margin-left:auto;display:flex;gap:6px;align-items:center">' +
          '<button class="icon-btn" onclick="event.stopPropagation();editCat(' + ci + ')">✏️</button>' +
          '<button class="icon-btn del" onclick="event.stopPropagation();delCat(' + ci + ')">🗑</button>' +
          '<span class="cat-chevron">▾</span>' +
        '</div>' +
      '</div>' +
      '<div class="cat-sites">' +
        '<div class="item-list" id="sites-' + ci + '">' + sitesHtml + '</div>' +
        '<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="addSite(' + ci + ')">+ 添加网站</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
window.toggleCat = function(ci) {
  document.getElementById('cat-block-'+ci).classList.toggle('open');
};
window.editCat = function(ci) {
  editingCatIdx = ci;
  const cat = CFG.categories[ci];
  document.getElementById('cat-modal-title').textContent = '编辑分类';
  document.getElementById('cat-icon').value = cat.icon||'';
  document.getElementById('cat-name').value = cat.name||'';
  showModal('cat-modal');
};
window.delCat = async function(ci) {
  if(!confirm('确认删除该分类及其所有网站？')) return;
  CFG.categories.splice(ci,1);
  renderCatList();
  await saveConfig({ categories: CFG.categories });
};
window.addSite = function(ci) {
  editingSiteRef = { catIdx:ci, siteIdx:-1 };
  pendingSiteIcon = '';
  document.getElementById('site-modal-title').textContent = '添加网站';
  document.getElementById('site-name').value = '';
  document.getElementById('site-url').value  = '';
  document.getElementById('site-desc').value = '';
  document.getElementById('site-icon-text').value = '';
  updateIconPreview('site', '', '');
  showModal('site-modal');
};
window.editSite = function(ci,si) {
  editingSiteRef = { catIdx:ci, siteIdx:si };
  pendingSiteIcon = '';
  const s = CFG.categories[ci].sites[si];
  document.getElementById('site-modal-title').textContent = '编辑网站';
  document.getElementById('site-name').value = s.name||'';
  document.getElementById('site-url').value  = s.url||'';
  document.getElementById('site-desc').value = s.desc||'';
  document.getElementById('site-icon-text').value = '';
  updateIconPreview('site', s.icon||'', s.url);
  showModal('site-modal');
};
window.delSite = async function(ci,si) {
  CFG.categories[ci].sites.splice(si,1);
  renderCatList();
  await saveConfig({ categories: CFG.categories });
};

document.getElementById('add-cat').addEventListener('click',()=>{
  editingCatIdx=-1;
  document.getElementById('cat-modal-title').textContent='添加分类';
  document.getElementById('cat-icon').value='';
  document.getElementById('cat-name').value='';
  showModal('cat-modal');
});
document.getElementById('cat-modal-cancel').addEventListener('click',()=>closeModal('cat-modal'));
document.getElementById('cat-modal').addEventListener('click',e=>{if(e.target.id==='cat-modal')closeModal('cat-modal')});
document.getElementById('cat-modal-save').addEventListener('click', async ()=>{
  const name=document.getElementById('cat-name').value.trim();
  const icon=document.getElementById('cat-icon').value.trim()||'📁';
  if(!name){ toast('请输入分类名称','err'); return; }
  if(editingCatIdx>=0){
    CFG.categories[editingCatIdx].name=name;
    CFG.categories[editingCatIdx].icon=icon;
  } else {
    CFG.categories.push({ id:uid(), name, icon, sites:[] });
  }
  renderCatList();
  await saveConfig({ categories:CFG.categories });
  closeModal('cat-modal');
});

document.getElementById('site-modal-cancel').addEventListener('click',()=>closeModal('site-modal'));
document.getElementById('site-modal').addEventListener('click',e=>{if(e.target.id==='site-modal')closeModal('site-modal')});
document.getElementById('site-modal-save').addEventListener('click', async ()=>{
  const name=document.getElementById('site-name').value.trim();
  const url =document.getElementById('site-url').value.trim();
  const desc=document.getElementById('site-desc').value.trim();
  const iconText=document.getElementById('site-icon-text').value.trim();
  if(!name||!url){ toast('名称和URL不能为空','err'); return; }
  const icon = pendingSiteIcon || iconText || '';
  const {catIdx,siteIdx} = editingSiteRef;
  const entry = { id: siteIdx>=0?(CFG.categories[catIdx].sites[siteIdx].id||uid()):uid(), name, url:fixUrl(url), icon, desc };
  if(siteIdx>=0) CFG.categories[catIdx].sites[siteIdx]=entry;
  else CFG.categories[catIdx].sites.push(entry);
  renderCatList();
  await saveConfig({ categories:CFG.categories });
  closeModal('site-modal');
});

document.getElementById('site-url').addEventListener('input', e => {
  if(!pendingSiteIcon && !document.getElementById('site-icon-text').value) {
    updateIconPreview('site', '', e.target.value);
  }
});

function renderSettings() {
  document.getElementById('reg-mode').value  = REG.mode||'closed';
  document.getElementById('invite-code').value = REG.inviteCode||'';
  document.getElementById('invite-code-field').style.display = REG.mode==='invite'?'':'none';
}
document.getElementById('reg-mode').addEventListener('change', e=>{
  document.getElementById('invite-code-field').style.display = e.target.value==='invite'?'':'none';
});
document.getElementById('gen-invite').addEventListener('click',()=>{
  document.getElementById('invite-code').value = Math.random().toString(36).slice(2,10).toUpperCase();
});
document.getElementById('save-reg').addEventListener('click', async ()=>{
  const mode = document.getElementById('reg-mode').value;
  const inviteCode = document.getElementById('invite-code').value.trim();
  REG.mode = mode; REG.inviteCode = inviteCode;
  const res = await api('/api/config',{ method:'PUT', body: JSON.stringify({ _regConfig:{ mode, inviteCode } }) });
  if(res.ok) toast('✓ 注册设置已保存');
  else toast(res.error||'保存失败','err');
});
document.getElementById('save-password').addEventListener('click', async ()=>{
  const p = document.getElementById('new-password').value;
  if(!p){ toast('请输入新密码','err'); return; }
  const res = await api('/api/config',{ method:'PUT', body: JSON.stringify({ _changePassword:{ newPassword:p } }) });
  if(res.ok){ toast('✓ 密码已更新'); document.getElementById('new-password').value=''; }
  else toast(res.error||'更新失败','err');
});
document.getElementById('export-btn').addEventListener('click',()=>{
  const blob = new Blob([JSON.stringify(CFG,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cf-nav-config.json';
  a.click();
});
document.getElementById('import-file').addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  try{
    const imported = JSON.parse(text);
    await saveConfig(imported);
    await loadConfig();
    renderAll();
    toast('✓ 配置已导入');
  }catch(err){ toast('JSON格式错误','err'); }
  e.target.value='';
});
document.getElementById('reset-btn').addEventListener('click', async ()=>{
  if(!confirm('确认重置所有导航配置为默认？')) return;
  toast('功能暂不支持，请手动导入默认配置');
});

function updateIconPreview(type, iconVal, siteUrl) {
  const display = document.getElementById(type+'-icon-display');
  if(!display) return;
  if(iconVal && iconVal.startsWith('data:')) {
    display.innerHTML = '<img src="' + iconVal + '" style="width:100%;height:100%;object-fit:contain;padding:4px;border-radius:10px" alt=""/>';
    return;
  }
  const fav = faviconUrl(siteUrl || '');
  if(fav) {
    display.innerHTML = '<img src="' + fav + '" loading="lazy" style="width:36px;height:36px;object-fit:contain;border-radius:6px" onerror="this.parentNode.textContent=\\'🌐\\'" alt=""/>';
  } else {
    display.textContent = '🌐';
  }
}

function setupIconUpload(fileInputId, previewType, onLoad) {
  const fileInput = document.getElementById(fileInputId);
  const previewBox = document.getElementById(previewType+'-icon-preview');
  if(!fileInput||!previewBox) return;
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    resizeImageToBase64(file, 64, 64, dataUrl => {
      updateIconPreview(previewType, dataUrl, '');
      onLoad(dataUrl);
    });
  });
  previewBox.addEventListener('dragover', e=>{ e.preventDefault(); previewBox.style.borderColor='var(--accent)'; });
  previewBox.addEventListener('dragleave', ()=>{ previewBox.style.borderColor=''; });
  previewBox.addEventListener('drop', e=>{
    e.preventDefault(); previewBox.style.borderColor='';
    const file = e.dataTransfer.files[0];
    if(!file||!file.type.startsWith('image/')) return;
    resizeImageToBase64(file, 64, 64, dataUrl => {
      updateIconPreview(previewType, dataUrl, '');
      onLoad(dataUrl);
    });
  });
}
setupIconUpload('site-icon-file',  'site',  url=>{ pendingSiteIcon=url; });
setupIconUpload('quick-icon-file', 'quick', url=>{ pendingQuickIcon=url; });

function resizeImageToBase64(file, w, h, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      const ctx = canvas.getContext('2d');
      const aspect = img.width/img.height;
      let sx=0,sy=0,sw=img.width,sh=img.height;
      if(aspect>1){ sw=img.height; sx=(img.width-sw)/2; }
      else if(aspect<1){ sh=img.width; sy=(img.height-sh)/2; }
      ctx.drawImage(img,sx,sy,sw,sh,0,0,w,h);
      cb(canvas.toDataURL('image/jpeg',0.85));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function setupUploadZone(zone, fileInput, maxBytes, cb) {
  zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e=>{
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if(!file||!file.type.startsWith('image/')) return;
    if(file.size>maxBytes){ toast('图片过大，最大 5MB','err'); return; }
    loadFileAsDataUrl(file, cb);
  });
  fileInput.addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    if(file.size>maxBytes){ toast('图片过大，最大 5MB','err'); return; }
    loadFileAsDataUrl(file, cb);
  });
}
function loadFileAsDataUrl(file, cb) {
  const reader = new FileReader();
  reader.onload = e => cb(e.target.result);
  reader.readAsDataURL(file);
}

function fixUrl(url) {
  return /^https?:\\/\\//.test(url) ? url : 'https://'+url;
}

boot();
</script>
</body>
</html>`;
}
