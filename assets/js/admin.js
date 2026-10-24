/* =========================================================
 * Anhuann · 后台管理脚本（admin.js）
 * ---------------------------------------------------------
 * 负责「后台页面」的全部交互：登录、按区块渲染表单、收集表单、
 * 保存（提交到 GitHub 仓库）、导出 data.js、Git 历史备份/恢复。
 *
 * 安全模型（免服务器）：
 *   - 不连任何后端；用你的 GitHub Token（repo 权限）直接调用 GitHub API；
 *   - Token 只存在浏览器内存/会话里，不会上传到任何第三方；
 *   - 所有读写都走 GitHub REST API（见下方 ghApi）。
 *
 * 数据流：
 *   登录 -> 用 Token 调 /user 校验 -> GET 仓库 data.js -> 渲染成表单
 *   修改表单 -> 点保存 -> 序列化 data.js -> PUT 回仓库（一次 commit）
 *   （每次保存都是一次提交，Git 历史天然是备份；也可点「恢复备份」回滚）
 *
 * 体验特性：
 *   - Ctrl+S / Cmd+S 快捷保存
 *   - 有未保存更改时底部提示橙色文字，关闭页面前浏览器会确认
 *   - 保存前做字段校验（标题/日期/邮箱等），不合法则中止并提示
 *   - 删除条目有二次确认；保存成功/失败有 toast 提示
 * ========================================================= */
(function () {
  "use strict"; // 开启严格模式，避免意外创建全局变量

  // 两个极简选择器： $(选择器) 取单个，$$(选择器) 取数组（便于 forEach）
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // 通用深拷贝：用 JSON 往返实现（仅用于纯数据对象，函数/循环引用不适用）
  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  /* ---------- GitHub 配置与 API 助手（免服务器，直接提交仓库） ---------- */
  const GH_OWNER = "grainshun";
  const GH_REPO = "grainshun.github.io";
  const GH_BRANCH = "main";
  const GH_DATA_PATH = "assets/js/data.js";
  // 中转代理地址（解决国内直连 api.github.com 不稳定/被拦截的问题）。
  // 留空 = 直连 api.github.com；部署 Cloudflare Worker 等代理后，把地址填到这里即可。
  const GH_PROXY = "";
  // token 仅存内存与浏览器会话，不写进代码；用于保存时把 data.js 提交回仓库
  let ghToken = "";
  function rememberToken(t) {
    ghToken = t;
    try { sessionStorage.setItem("anhuann_gh_token", t); } catch (e) {}
  }
  function forgetToken() {
    ghToken = "";
    try { sessionStorage.removeItem("anhuann_gh_token"); } catch (e) {}
  }
  // 通用 GitHub REST 调用，自动带 token
  async function ghApi(path, opts) {
    opts = opts || {};
    const headers = Object.assign(
      { "Accept": "application/vnd.github+json", "User-Agent": "anhuann-admin" },
      opts.headers || {}
    );
    if (ghToken) headers["Authorization"] = "Bearer " + ghToken;
    const base = GH_PROXY ? GH_PROXY.replace(/\/$/, "") : "https://api.github.com";
    const init = {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    };
    // 国内直连 GitHub 常间歇性超时：每次请求加超时 + 自动重试，能连上就用
    const maxTries = 3;
    let lastErr = null;
    for (let i = 0; i < maxTries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 10000);
      try {
        const res = await fetch(base + path, Object.assign({}, init, { signal: ctrl.signal }));
        let json = null, text = "";
        try { text = await res.text(); json = text ? JSON.parse(text) : null; } catch (e) {}
        return { status: res.status, json, text };
      } catch (e) {
        lastErr = e;
        if (i < maxTries - 1) await new Promise(function (r) { setTimeout(r, 900 * (i + 1)); });
      } finally {
        clearTimeout(timer);
      }
    }
    return { status: 0, json: null, text: "", error: lastErr };
  }
  // 把内容对象生成为完整 data.js 文本（与导出同格式）
  function buildDataJs(data) {
    return (
      "/* =========================================================\n" +
      "   Anhuann · 内容配置文件（data.js）\n" +
      "   由后台保存时自动生成并提交到 GitHub 仓库。\n" +
      "   如需手动修改：编辑后覆盖 assets/js/data.js 即可。\n" +
      "   ========================================================= */\n\n" +
      "const SITE = " + jsVal(data.site, 0) + ";\n\n" +
      "const ABOUT = " + jsVal(data.about, 0) + ";\n\n" +
      "const POSTS = " + jsVal(data.posts, 0) + ";\n\n" +
      "const SOCIALS = " + jsVal(data.socials, 0) + ";\n\n" +
      "const UI = " + jsVal(data.ui || {}, 0) + ";\n"
    );
  }
  // 最近一次读取到的 data.js 的 sha，保存时用于乐观并发控制
  let currentSha = null;
  // 从仓库拉取最新 data.js 文本与 sha
  async function fetchDataJs() {
    const r = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH + "?ref=" + GH_BRANCH);
    if (r.status !== 200 || !r.json) throw new Error("读取仓库 data.js 失败(" + r.status + ")");
    currentSha = r.json.sha;
    return base64ToUtf8(r.json.content);
  }
  // 用 new Function 把 data.js 解析成内容对象（与 server.js 同源思路）
  function parseDataJs(text) {
    const fn = new Function(
      text + "\nreturn { SITE: SITE, ABOUT: ABOUT, POSTS: POSTS, SOCIALS: SOCIALS, UI: (typeof UI !== 'undefined' ? UI : {}) };"
    );
    const d = fn();
    // admin.js 内部统一用小写键（site/about/posts/socials/ui），与渲染/收集逻辑保持一致
    return { site: d.SITE, about: d.ABOUT, posts: d.POSTS, socials: d.SOCIALS, ui: d.UI || {} };
  }

  /* ---------- 当前编辑中的数据（来自服务器） ---------- */
  let DATA = null; // 结构：{ site, about, socials, posts }，渲染与收集都以它为基准

  // 从 GitHub 仓库拉取最新 data.js，解析后存进 DATA
  async function loadContent() {
    const text = await fetchDataJs();
    DATA = parseDataJs(text);
  }

  /* ---------- 登录相关 DOM 引用 ---------- */
  const loginScreen = $("#loginScreen"); // 登录门禁遮罩
  const adminPanel = $("#adminPanel");   // 登录后的后台主体

  // 用 token 读取仓库里的 data.js：既能验证 token 有效性（无效会 401），又顺带载入内容。
  // 相比校验 /user，这样只需 repo（公开仓库甚至 public_repo）权限即可，门槛更低。
  async function loginWithToken(t, remember) {
    const probe = await ghApi(
      "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH + "?ref=" + GH_BRANCH
    );
    if (probe.status === 401 || probe.status === 403) throw new Error("TOKEN_INVALID");
    if (probe.status !== 200 || !probe.json) throw new Error("PROBE_FAIL:" + probe.status);
    if (remember) rememberToken(t); else ghToken = t;
    currentSha = probe.json.sha; // 复用本次读取结果，省一次请求
    DATA = parseDataJs(base64ToUtf8(probe.json.content));
    showAdmin();
  }
  // 处理登录提交：用 GitHub Token 验证并载入内容，进入后台
  async function attempt() {
    const t = ($("#loginToken").value || "").trim();
    if (!t) {
      $("#loginError").textContent = "请填写 GitHub Token";
      return;
    }
    const remember = $("#rememberMe") && $("#rememberMe").checked;
    const btn = $("#loginBtn");
    btn.disabled = true; btn.textContent = "连接中…";
    $("#loginError").textContent = "";
    try {
      await loginWithToken(t, remember);
    } catch (e) {
      const m = String((e && e.message) || "");
      if (m.indexOf("TOKEN_INVALID") === 0) {
        $("#loginError").textContent = "Token 无效或无权限，请检查（需对仓库有写权限）";
      } else if (m.indexOf("PROBE_FAIL") === 0) {
        $("#loginError").textContent = "无法访问仓库（" + m.split(":")[1] + "），请稍后重试";
      } else {
        $("#loginError").textContent = "连接 GitHub 失败（已自动重试）。若网络对 GitHub 不稳，请稍后再试或换个网络环境。";
      }
    } finally {
      btn.disabled = false; btn.textContent = "进入后台";
    }
  }

  // 登录成功后：隐藏登录遮罩，显示后台，并渲染各区块表单
  function showAdmin() {
    loginScreen.hidden = true;
    adminPanel.hidden = false;
    renderAll();
  }

  // 登出：清除本地 token，回到登录页
  async function logout() {
    forgetToken();
    adminPanel.hidden = true;
    loginScreen.hidden = false;
    const tk = $("#loginToken"); if (tk) tk.value = "";
    $("#loginError").textContent = "";
  }

  // 绑定按钮/回车事件
  $("#loginBtn").addEventListener("click", attempt);
  $("#loginToken").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attempt(); // token 框回车即登录
  });
  $("#logoutBtn").addEventListener("click", logout);

  /* ---------- 通用 UI 小工具 ---------- */
  // 创建元素：tag 标签名，cls 类名，props 直接挂到元素上的属性（如 type/value）
  function el(tag, cls, props) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (props) Object.assign(e, props);
    return e;
  }
  // 包装成一个「带标签的字段」：label 文字 + 控件
  function field(labelText, control) {
    const f = el("label", "field");
    const s = el("span", "field-label");
    s.textContent = labelText;
    f.appendChild(s);
    f.appendChild(control);
    return f;
  }
  // 单行文本输入框
  function textInput(val) {
    const i = el("input", "input");
    i.type = "text";
    i.value = val == null ? "" : String(val);
    return i;
  }
  // 多行文本域；若值是数组（如正文段落）则用换行符拼成多行文本
  function textareaInput(val, rows) {
    const t = el("textarea", "input");
    t.rows = rows || 4;
    t.value = Array.isArray(val) ? val.join("\n") : val == null ? "" : String(val);
    return t;
  }
  // 在文本域光标处（或选中文字两侧）插入 Markdown 标记
  function insertMd(ta, pre, post) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const v = ta.value;
    const sel = v.slice(s, e) || "文字";
    ta.value = v.slice(0, s) + pre + sel + post + v.slice(e);
    const ns = s + pre.length, ne = ns + sel.length;
    ta.focus();
    ta.setSelectionRange(ns, ne);
    ta.dispatchEvent(new Event("input"));
  }
  /* ---------- 数学公式渲染（KaTeX，后台预览用） ---------- */
  // 把 scope 容器内的 $...$ / $$...$$ 等交给 KaTeX 渲染；库由 admin.html 本地引入。
  function renderMath(scope) {
    if (scope && window.renderMathInElement) {
      try {
        window.renderMathInElement(scope, {
          delimiters: [
            { left: "$$", right: "$$", display: true },   // 块级公式
            { left: "$", right: "$", display: false },     // 行内公式
            { left: "\\(", right: "\\)", display: false }, // 备选行内写法
            { left: "\\[", right: "\\]", display: true }   // 备选块级写法
          ],
          throwOnError: false // 公式写错时不抛错，只标红该处
        });
      } catch (e) {}
    }
  }
  // Word 风格整页预览：把当前 Markdown 渲染成干净文档，全屏查看
  function openDocPreview(md) {
    const body = $("#previewBody");
    if (!body) return;
    body.innerHTML = miniMarkdown(md == null ? "" : md);
    renderMath(body);
    const modal = $("#previewModal");
    if (modal) {
      modal.hidden = false;
      document.body.classList.add("is-locked");
    }
  }
  function closeDocPreview() {
    const modal = $("#previewModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("is-locked");
  }
  // Markdown 编辑器：工具栏 + 文本域 + 实时预览，写文章/故事更省心
  function markdownField(labelText, value, rows) {
    const wrap = el("div", "md-editor");
    // 工具栏
    const bar = el("div", "md-toolbar");
    const tools = [
      ["B", "加粗", "**", "**"],
      ["I", "斜体", "*", "*"],
      ["H", "标题", "### ", ""],
      ["❝", "引用", "> ", ""],
      ["•", "列表", "- ", ""],
      ["🔗", "链接", "[", "](https://)"],
      ["</>", "代码", "`", "`"],
      ["∑", "行内公式 $…$", "$", "$"],
      ["∬", "块级公式 $$…$$", "$$\n", "\n$$"],
    ];
    tools.forEach(([t, title, pre, post]) => {
      const b = el("button", "md-btn");
      b.type = "button";
      b.textContent = t;
      b.title = title;
      b.addEventListener("click", () =>
        insertMd(wrap.querySelector("textarea"), pre, post)
      );
      bar.appendChild(b);
    });
    // Word 风格整页预览按钮
    const pv = el("button", "md-btn md-preview-open");
    pv.type = "button";
    pv.title = "整页预览（Word 风格）";
    pv.textContent = "👁 预览";
    pv.addEventListener("click", () => {
      const area = wrap.querySelector("textarea");
      openDocPreview(area ? area.value : "");
    });
    bar.appendChild(pv);
    // 编辑区 + 预览区
    const ta = textareaInput(value, rows || 6);
    ta.classList.add("md-input");
    ta.placeholder =
      "支持 Markdown：# 标题、**加粗**、- 列表、> 引用、[链接](url)、`代码`，以及 $行内公式$ / $$块级公式$$";
    const prev = el("div", "md-preview md-live");
    const render = () => { prev.innerHTML = miniMarkdown(ta.value); renderMath(prev); };
    ta.addEventListener("input", render);
    render();
    const split = el("div", "md-split");
    split.appendChild(ta);
    split.appendChild(prev);
    wrap.appendChild(bar);
    wrap.appendChild(split);
    return field(labelText, wrap);
  }
  // 复选框
  function checkboxInput(val) {
    const i = el("input");
    i.type = "checkbox";
    i.checked = !!val;
    return i;
  }
  // 两个颜色选择器（左/右），用于社交徽章渐变
  function colorPair(val) {
    const wrap = el("div", "color-pair");
    const a = el("input");
    a.type = "color";
    a.value = (val && val[0]) || "#E9A08C";
    const b = el("input");
    b.type = "color";
    b.value = (val && val[1]) || "#D4785F";
    wrap.appendChild(a);
    wrap.appendChild(b);
    return wrap;
  }
  // 把多行文本按行拆成数组（去空白、去空行），用于正文/标签等
  function linesToArr(v) {
    return v
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /* ---------- 轻提示（toast）与「未保存」状态 ---------- */
  // 屏幕下方自动弹出的小提示，2.2 秒后淡出；复用同一个节点
  let toastTimer = null;
  function toast(message) {
    let t = $("#adminToast");
    if (!t) {
      t = el("div");
      t.id = "adminToast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2200);
  }

  let dirty = false; // 是否有未保存的更改
  const DIRTY_TEXT = "● 有未保存的更改（Ctrl+S 保存）";

  // 底部提示栏：显式传入的文字优先（如保存成功/失败）；
  // 没传文字时，有未保存更改就显示橙色提醒，否则清空。
  function refreshHint(text) {
    const hint = $("#saveHint");
    if (!hint) return;
    if (text) {
      hint.textContent = text;
      hint.classList.remove("is-dirty");
    } else if (dirty) {
      hint.textContent = DIRTY_TEXT;
      hint.classList.add("is-dirty");
    } else {
      hint.textContent = "";
      hint.classList.remove("is-dirty");
    }
  }
  // 标记为「有未保存更改」（只在第一次真正变化时刷新，避免频繁重排）
  function markDirty() {
    if (dirty) return;
    dirty = true;
    refreshHint("");
  }
  function clearDirty() {
    dirty = false;
  }

  /* ---------- 渲染：站点信息 ---------- */
  // 字段清单：[数据键名, 显示标签]；顺序即表单从上到下的顺序
  const SITE_FIELDS = [
    ["name", "站点名字"],
    ["initial", "首字母"],
    ["avatar", "头像路径"],
    ["greeting", "首屏问候"],
    ["tagline", "首屏标语"],
    ["description", "首页简介"],
    ["email", "邮箱"],
    ["footerNote", "页脚备注"],
  ];
  function renderSite() {
    const pane = $("#pane-site");
    pane.innerHTML = ""; // 先清空，避免重复渲染
    SITE_FIELDS.forEach(([key, label]) => {
      let control;
      // 首页简介用多行文本域；其余用单行输入框
      if (key === "description") {
        control = textareaInput(DATA.site[key], 3);
      } else {
        control = textInput(DATA.site[key]);
        if (key === "initial") control.maxLength = 2; // 首字母最多 2 个字符
      }
      control.dataset.key = key; // 用 data-key 标记，收集时据此回填
      pane.appendChild(field(label, control));
    });
  }

  /* ---------- 渲染：关于我 ---------- */
  // 单个「主题故事」编辑卡片（标题 + 正文）
  function themeItem(t) {
    const item = el("div", "list-item");
    const title = textInput(t.title);
    title.placeholder = "标题";
    const body = markdownField("正文（支持 Markdown，右侧实时预览）", t.body, 4);
    const del = el("button", "item-del");
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", () => {
      if (confirm("确定删除这张主题故事卡吗？")) {
        item.remove();
        markDirty();
      }
    });
    item.appendChild(field("标题", title));
    item.appendChild(body);
    item.appendChild(del);
    return item;
  }
  function renderAbout() {
    const pane = $("#pane-about");
    pane.innerHTML = "";
    // 引入语（单段文本域），用 data-about 标记便于收集
    const intro = textareaInput(DATA.about.intro, 3);
    intro.dataset.about = "intro";
    pane.appendChild(field("引入语", intro));
    // 主题列表容器（固定 id，收集时按它查找）
    const list = el("div", "list");
    list.id = "aboutThemeList";
    DATA.about.themes.forEach((t) => list.appendChild(themeItem(t)));
    pane.appendChild(field("主题故事（每张一个）", list));
    // 「+ 添加主题」按钮
    const add = el("button", "btn btn-ghost btn-sm");
    add.type = "button";
    add.textContent = "+ 添加主题";
    add.addEventListener("click", () =>
      list.appendChild(themeItem({ title: "新主题", body: ["内容"] }))
    );
    pane.appendChild(add);
  }

  /* ---------- 渲染：社交账号 ---------- */
  // 单个社交账号编辑卡片
  function socialItem(s) {
    const item = el("div", "list-item");
    const name = textInput(s.name);
    name.placeholder = "显示名";
    const handle = textInput(s.handle);
    handle.placeholder = "账号 / handle";
    const url = textInput(s.url);
    url.placeholder = "跳转链接（没有留空）";
    const icon = textInput(s.icon);
    icon.placeholder = "图标：github / mail / x / wechat / bilibili / zhihu / douyin / globe / rss";
    const copy = checkboxInput(s.copy);       // 是否「点击复制账号」
    const colors = colorPair(s.color);        // 徽章渐变色
    const del = el("button", "item-del");
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", () => {
      if (confirm("确定删除这个社交账号吗？")) {
        item.remove();
        markDirty();
      }
    });

    item.appendChild(field("名称", name));
    item.appendChild(field("账号", handle));
    item.appendChild(field("链接", url));
    item.appendChild(field("图标", icon));
    item.appendChild(field("点击复制账号", copy));
    item.appendChild(field("徽章颜色（左/右）", colors));
    item.appendChild(del);
    return item;
  }
  function renderSocials() {
    const pane = $("#pane-socials");
    pane.innerHTML = "";
    const list = el("div", "list");
    DATA.socials.forEach((s) => list.appendChild(socialItem(s)));
    pane.appendChild(field("社交账号", list));
    const add = el("button", "btn btn-ghost btn-sm");
    add.type = "button";
    add.textContent = "+ 添加账号";
    add.addEventListener("click", () =>
      list.appendChild(
        socialItem({
          name: "新平台",
          handle: "",
          url: "",
          icon: "globe",
          copy: false,
          color: ["#E9A08C", "#D4785F"],
        })
      )
    );
    pane.appendChild(add);
  }

  /* ---------- 渲染：博客文章 ---------- */
  // 单篇文章编辑卡片
  function postItem(p) {
    const item = el("div", "list-item");
    const title = textInput(p.title);
    title.placeholder = "标题";
    const date = textInput(p.date);
    date.placeholder = "日期 2026-09-28";
    const tags = textInput((p.tags || []).join(", ")); // 标签以逗号拼成一行
    tags.placeholder = "标签，逗号分隔";
    const category = textInput(p.category || "");
    category.placeholder = "分类，如：设计 / 建站 / 随笔";
    const excerpt = textInput(p.excerpt);
    excerpt.placeholder = "摘要";
    const body = markdownField("正文（支持 Markdown，右侧实时预览）", p.body, 8);
    const del = el("button", "item-del");
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", () => {
      if (confirm("确定删除这篇文章吗？")) {
        item.remove();
        markDirty();
      }
    });

    item.appendChild(field("标题", title));
    item.appendChild(field("日期", date));
    item.appendChild(field("标签", tags));
    item.appendChild(field("分类", category));
    item.appendChild(field("摘要", excerpt));
    item.appendChild(body);
    item.appendChild(del);
    return item;
  }
  function renderPosts() {
    const pane = $("#pane-posts");
    pane.innerHTML = "";
    const list = el("div", "list");
    DATA.posts.forEach((p) => list.appendChild(postItem(p)));
    pane.appendChild(field("博客文章", list));
    const add = el("button", "btn btn-ghost btn-sm");
    add.type = "button";
    add.textContent = "+ 添加文章";
    add.addEventListener("click", () =>
      list.appendChild(
        postItem({ title: "新文章", date: "", tags: [], category: "", excerpt: "", body: [""] })
      )
    );
    pane.appendChild(add);
  }

  /* ---------- 渲染：界面文案（UI 区块） ---------- */
  // 扁平字段清单：[「组.键」, 显示标签]；顺序即表单从上到下的顺序
  const UI_FIELDS = [
    ["metaDescription", "SEO 描述（搜索引擎结果显示）"],
    ["metaKeywords", "SEO 关键词（逗号分隔）"],
    ["nav.home", "导航：首页"],
    ["nav.about", "导航：关于"],
    ["nav.blog", "导航：博客"],
    ["nav.contact", "导航：联系"],
    ["hero.primaryBtn", "首屏主按钮"],
    ["hero.ghostBtn", "首屏次按钮"],
    ["hero.scrollHint", "首屏滚动提示（无障碍文字）"],
    ["authorStatus", "作者状态（首页展示的近况/更新频率，如：每周更新中）"],
    ["about.kicker", "关于我：小标签"],
    ["about.title", "关于我：标题"],
    ["about.sub", "关于我：副标题"],
    ["blog.kicker", "博客：小标签"],
    ["blog.title", "博客：标题"],
    ["blog.sub", "博客：副标题"],
    ["blog.emptyHint", "博客：空状态提示"],
    ["contact.kicker", "联系：小标签"],
    ["contact.title", "联系：标题"],
    ["contact.sub", "联系：副标题"],
  ];
  // 按 "a.b" 路径取深层级值（取不到返回空串）
  function uiGet(obj, pathKey) {
    return pathKey.split(".").reduce((o, k) => (o == null ? o : o[k]), obj) || "";
  }
  // 按 "a.b" 路径写入深层级值（中间层不存在就建空对象）
  function uiSet(obj, pathKey, val) {
    const keys = pathKey.split(".");
    let cur = obj;
    while (keys.length > 1) {
      const k = keys.shift();
      if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[keys[0]] = val;
  }
  function renderUI() {
    const pane = $("#pane-ui");
    pane.innerHTML = "";
    const u = DATA.ui && typeof DATA.ui === "object" ? DATA.ui : {};
    UI_FIELDS.forEach(([key, label]) => {
      let control;
      // 较长的文案用多行文本域，其余用单行输入框
      if (/^(metaDescription|metaKeywords|.*\.sub|.*emptyHint)$/.test(key)) {
        control = textareaInput(uiGet(u, key), 2);
      } else {
        control = textInput(uiGet(u, key));
      }
      control.dataset.uiKey = key; // 用 data-ui-key 标记，收集时据此回填
      pane.appendChild(field(label, control));
    });
  }
  // 收集界面文案：把表单按路径写回嵌套对象
  function collectUI() {
    const out = {};
    $$("#pane-ui [data-ui-key]").forEach((inp) => {
      uiSet(out, inp.dataset.uiKey, inp.value);
    });
    return out;
  }

  // 一次性渲染全部「内容」区块（工具箱不依赖 DATA，单独渲染）
  function renderAll() {
    renderSite();
    renderUI();
    renderAbout();
    renderSocials();
    renderPosts();
    renderTools();
    clearDirty();          // 刚渲染出来，视为「已保存」状态
    refreshHint("");
  }

  /* ---------- 工具箱（纯前端小工具，无需服务器） ---------- */
  // 文本转义，防止 Markdown 预览里的用户输入破坏页面结构/被注入
  function escapeHtmlstr(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  // 行内 Markdown：代码 / 加粗 / 斜体 / 链接（输入已转义，链接属性安全）
  function mdInline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>'
      );
  }
  // 极简 Markdown 解析：标题 / 引用 / 有序·无序列表 / 加粗斜体代码链接 / 段落
  function miniMarkdown(src) {
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      // 标题 # ## ###
      let m = line.match(/^(#{1,3})\s+(.*)$/);
      if (m) {
        const lv = m[1].length;
        html += "<h" + lv + ">" + mdInline(escapeHtmlstr(m[2])) + "</h" + lv + ">";
        i++;
        continue;
      }
      // 引用 >
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        html += "<blockquote>" + mdInline(escapeHtmlstr(buf.join(" "))) + "</blockquote>";
        continue;
      }
      // 无序列表 - / *
      if (/^[-*]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          buf.push("<li>" + mdInline(escapeHtmlstr(lines[i].replace(/^[-*]\s+/, ""))) + "</li>");
          i++;
        }
        html += "<ul>" + buf.join("") + "</ul>";
        continue;
      }
      // 有序列表 1.
      if (/^\d+\.\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          buf.push("<li>" + mdInline(escapeHtmlstr(lines[i].replace(/^\d+\.\s+/, ""))) + "</li>");
          i++;
        }
        html += "<ol>" + buf.join("") + "</ol>";
        continue;
      }
      // 普通段落：聚合连续的非空、非块级行
      const buf = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/(^#{1,3}\s)|(^>\s?)|(^[-*]\s+)|(^\d+\.\s+)/.test(lines[i])
      ) {
        buf.push(mdInline(escapeHtmlstr(lines[i])));
        i++;
      }
      html += "<p>" + buf.join("<br>") + "</p>";
    }
    return html || '<p class="md-empty">（预览区，在左侧输入 Markdown）</p>';
  }

  // UTF-8 安全的 Base64 编解码（原生 btoa/atob 只能处理 Latin1，需先转 UTF-8）
  function utf8ToBase64(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  }
  function base64ToUtf8(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // 渲染工具箱面板：若干互相独立的小工具卡片
  function renderTools() {
    const pane = $("#pane-tools");
    pane.innerHTML = "";
    const grid = el("div", "tool-grid");
    pane.appendChild(grid);

    // 1) Markdown 实时预览（左侧输入，右侧实时渲染）
    (function () {
      const card = el("div", "tool-card");
      const h = el("h3"); h.textContent = "Markdown 实时预览"; card.appendChild(h);
      const ta = textareaInput("", 8);
      ta.placeholder = "在这里输入 Markdown，右侧实时预览…";
      card.appendChild(ta);
      const out = el("div", "md-preview modal-body");
      const draw = () => { out.innerHTML = miniMarkdown(ta.value); renderMath(out); };
      ta.addEventListener("input", draw);
      draw();
      card.appendChild(out);
      grid.appendChild(card);
    })();

    // 2) JSON 格式化 / 压缩 / 校验
    (function () {
      const card = el("div", "tool-card");
      const h = el("h3"); h.textContent = "JSON 格式化 / 校验"; card.appendChild(h);
      const ta = textareaInput("", 8);
      ta.placeholder = "粘贴 JSON…"; card.appendChild(ta);
      const act = el("div", "tool-actions");
      const bFmt = el("button", "btn btn-ghost btn-sm"); bFmt.type = "button"; bFmt.textContent = "格式化";
      const bMin = el("button", "btn btn-ghost btn-sm"); bMin.type = "button"; bMin.textContent = "压缩";
      const bChk = el("button", "btn btn-ghost btn-sm"); bChk.type = "button"; bChk.textContent = "校验";
      act.append(bFmt, bMin, bChk); card.appendChild(act);
      const res = el("div", "tool-result"); card.appendChild(res);
      const show = (val, err) => {
        res.className = err ? "tool-result error" : "tool-result";
        res.textContent = err ? err : val;
      };
      bFmt.addEventListener("click", () => {
        try { show(JSON.stringify(JSON.parse(ta.value), null, 2)); }
        catch (e) { show(null, e.message); }
      });
      bMin.addEventListener("click", () => {
        try { show(JSON.stringify(JSON.parse(ta.value))); }
        catch (e) { show(null, e.message); }
      });
      bChk.addEventListener("click", () => {
        try { JSON.parse(ta.value); show("✓ 合法 JSON"); }
        catch (e) { show(null, "✗ " + e.message); }
      });
      grid.appendChild(card);
    })();

    // 3) Base64 编 / 解码（支持中文）
    (function () {
      const card = el("div", "tool-card");
      const h = el("h3"); h.textContent = "Base64 编 / 解码"; card.appendChild(h);
      const ta = textareaInput("", 6);
      ta.placeholder = "输入文本…"; card.appendChild(ta);
      const act = el("div", "tool-actions");
      const bEnc = el("button", "btn btn-ghost btn-sm"); bEnc.type = "button"; bEnc.textContent = "编码 →";
      const bDec = el("button", "btn btn-ghost btn-sm"); bDec.type = "button"; bDec.textContent = "← 解码";
      act.append(bEnc, bDec); card.appendChild(act);
      const res = el("div", "tool-result"); card.appendChild(res);
      const set = (val, err) => {
        res.className = err ? "tool-result error" : "tool-result";
        res.textContent = val;
      };
      bEnc.addEventListener("click", () => {
        try { set(utf8ToBase64(ta.value)); }
        catch (e) { set(e.message, true); }
      });
      bDec.addEventListener("click", () => {
        try { set(base64ToUtf8(ta.value.trim())); }
        catch (e) { set("解码失败：不是合法的 Base64", true); }
      });
      grid.appendChild(card);
    })();

    // 4) 字数统计（实时）
    (function () {
      const card = el("div", "tool-card");
      const h = el("h3"); h.textContent = "字数统计"; card.appendChild(h);
      const ta = textareaInput("", 6);
      ta.placeholder = "输入要统计的文本…"; card.appendChild(ta);
      const res = el("div", "tool-result"); card.appendChild(res);
      const count = () => {
        const t = ta.value;
        const total = t.length;
        const noSpace = t.replace(/\s/g, "").length;
        const lines = t ? t.split("\n").length : 0;
        const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
        const en = (t.match(/[A-Za-z0-9_]+/g) || []).length;
        res.className = "tool-result";
        res.textContent =
          "字符总数：" + total + "\n不含空白：" + noSpace +
          "\n行数：" + lines + "\n中文字数：" + cn + "\n英文/数字词：" + en;
      };
      ta.addEventListener("input", count);
      count();
      grid.appendChild(card);
    })();

    // 5) 时间戳转换（秒/毫秒/日期互转，支持「填入当前」）
    (function () {
      const card = el("div", "tool-card");
      const h = el("h3"); h.textContent = "时间戳转换"; card.appendChild(h);
      const inp = textInput("");
      inp.placeholder = "Unix 秒/毫秒 或 日期，如 2026-09-28 12:00:00"; card.appendChild(inp);
      const act = el("div", "tool-actions");
      const bConv = el("button", "btn btn-ghost btn-sm"); bConv.type = "button"; bConv.textContent = "转换";
      const bNow = el("button", "btn btn-ghost btn-sm"); bNow.type = "button"; bNow.textContent = "填入当前";
      act.append(bConv, bNow); card.appendChild(act);
      const res = el("div", "tool-result"); card.appendChild(res);
      const conv = () => {
        const v = inp.value.trim();
        if (!v) { res.className = "tool-result error"; res.textContent = "请输入时间戳或日期"; return; }
        let d;
        if (/^\d+$/.test(v)) {
          const n = Number(v);
          d = new Date(n <= 1e11 ? n * 1000 : n); // 10 位当秒，13 位当毫秒
        } else {
          d = new Date(v);
        }
        if (isNaN(d.getTime())) {
          res.className = "tool-result error"; res.textContent = "无法识别为时间"; return;
        }
        res.className = "tool-result";
        res.textContent =
          "Unix 秒：" + Math.floor(d.getTime() / 1000) +
          "\nUnix 毫秒：" + d.getTime() +
          "\n本地时间：" + d.toLocaleString() +
          "\nUTC：" + d.toUTCString();
      };
      bConv.addEventListener("click", conv);
      bNow.addEventListener("click", () => { inp.value = String(Math.floor(Date.now() / 1000)); conv(); });
      grid.appendChild(card);
    })();
  }

  /* ---------- 收集：把表单读回数据对象 ---------- */
  // 站点信息：扫描所有带 data-key 的输入框，按键名取回值
  function collectSite() {
    const obj = {};
    $$("#pane-site .field [data-key]").forEach((inp) => {
      obj[inp.dataset.key] = inp.value;
    });
    return obj;
  }
  // 关于我：引入语 + 每个主题卡的标题/正文
  function collectAbout() {
    const intro = ($("#pane-about [data-about='intro']") || {}).value || "";
    const themes = $$("#aboutThemeList .list-item").map((it) => {
      const inputs = it.querySelectorAll("input, textarea");
      return { title: inputs[0].value, body: linesToArr(inputs[1].value) };
    });
    return { intro, themes };
  }
  // 社交账号：每个卡片里的文本/复选/颜色输入按固定顺序取出
  function collectSocials() {
    return $$("#pane-socials .list-item").map((it) => {
      const inp = it.querySelectorAll("input[type='text'], textarea");
      const checks = it.querySelectorAll("input[type='checkbox']");
      const colors = it.querySelectorAll("input[type='color']");
      return {
        name: inp[0].value,
        handle: inp[1].value,
        url: inp[2].value,
        icon: inp[3].value,
        copy: checks[0].checked,
        color: [colors[0].value, colors[1].value],
      };
    });
  }
  // 博客文章：每个卡片的 标题/日期/标签/摘要/正文 按输入顺序取出
  function collectPosts() {
    return $$("#pane-posts .list-item").map((it) => {
      const inp = it.querySelectorAll("input, textarea");
      return {
        title: inp[0].value,
        date: inp[1].value,
        tags: linesToArr(inp[2].value),
        category: (inp[3].value || "").trim(),
        excerpt: inp[4].value,
        body: linesToArr(inp[5].value),
      };
    });
  }
  // 汇总成完整的 { site, about, socials, posts, ui }
  function collectAll() {
    return {
      site: collectSite(),
      ui: collectUI(),
      about: collectAbout(),
      socials: collectSocials(),
      posts: collectPosts(),
    };
  }

  /* ---------- 保存 / 导出 ---------- */
  // 保存前校验：返回错误信息字符串，没有问题则返回 null
  function validate(data) {
    const errs = [];
    if (!String((data.site && data.site.name) || "").trim()) {
      errs.push("「站点名字」不能为空");
    }
    const email = String((data.site && data.site.email) || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.push("邮箱格式不对：" + email);
    }
    if (!data.about || !Array.isArray(data.about.themes) || !data.about.themes.length) {
      errs.push("「关于我」至少要保留一个主题故事");
    }
    (data.posts || []).forEach((p, i) => {
      if (!String(p.title || "").trim()) errs.push(`第 ${i + 1} 篇文章缺少标题`);
      if (p.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date).trim())) {
        errs.push(`《${p.title || "第" + (i + 1) + "篇"}》日期格式应为 2026-10-17`);
      }
    });
    (data.socials || []).forEach((s, i) => {
      if (!String(s.name || "").trim()) errs.push(`第 ${i + 1} 个社交账号缺少名称`);
    });
    return errs.length ? errs.join("；") : null;
  }

  // 保存：校验 -> 收集表单 -> 序列化 data.js -> 提交回 GitHub 仓库
  async function save() {
    const data = collectAll();
    const err = validate(data);
    if (err) {
      refreshHint("保存失败：" + err);
      toast("保存失败：" + err);
      return;
    }
    DATA = data; // 先更新内存中的数据（防止重复提交时读旧值）
    const btn = $("#saveBtn");
    btn.disabled = true;
    btn.textContent = "保存中…";
    try {
      const content = buildDataJs(data);
      const body = {
        message: "content: update via admin",
        content: utf8ToBase64(content),
        branch: GH_BRANCH,
      };
      if (currentSha) body.sha = currentSha;
      let r = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH, {
        method: "PUT",
        body,
      });
      // 并发冲突（sha 过期）：重新拉取最新 sha 再提交一次
      if (r.status === 409) {
        await fetchDataJs();
        body.sha = currentSha;
        r = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH, {
          method: "PUT",
          body,
        });
      }
      if (r.status >= 200 && r.status < 300) {
        if (r.json && r.json.content) currentSha = r.json.content.sha;
        clearDirty();
        refreshHint("已保存到 GitHub，稍后刷新前台即可生效。");
        toast("✓ 已保存并推送 GitHub");
      } else if (r.status === 401) {
        refreshHint("Token 失效，请重新登录。");
        toast("Token 失效，请重新登录");
        logout();
      } else {
        refreshHint("保存失败(" + r.status + ")：" + ((r.json && r.json.message) || ""));
        toast("保存失败(" + r.status + ")");
      }
    } catch (e) {
      refreshHint("网络错误，无法连接 GitHub");
      toast("网络错误，无法连接 GitHub");
    } finally {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }

  // 把 JS 值序列化成可读源码文本（与 server.js 的 jsVal 同理）
  function jsVal(v, indent) {
    const pad = "  ".repeat(indent);
    const pad1 = "  ".repeat(indent + 1);
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return (
        "[\n" +
        v.map((x) => pad1 + jsVal(x, indent + 1)).join(",\n") +
        "\n" +
        pad +
        "]"
      );
    }
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      if (!keys.length) return "{}";
      return (
        "{\n" +
        keys
          .map((k) => pad1 + JSON.stringify(k) + ": " + jsVal(v[k], indent + 1))
          .join(",\n") +
        "\n" +
        pad +
        "}"
      );
    }
    return "null";
  }

  // 导出 data.js：把当前内容生成为完整 data.js 文本并触发下载（用于备份/手动替换）
  function exportFile() {
    const data = collectAll();
    const out =
      "/* =========================================================\n" +
      "   Anhuann · 内容配置文件（由后台导出）\n" +
      "   改完保存后，覆盖 assets/js/data.js，刷新 index.html 生效。\n" +
      "   ========================================================= */\n\n" +
      "const SITE = " +
      jsVal(data.site, 0) +
      ";\n\n" +
      "const ABOUT = " +
      jsVal(data.about, 0) +
      ";\n\n" +
      "const POSTS = " +
      jsVal(data.posts, 0) +
      ";\n\n" +
      "const SOCIALS = " +
      jsVal(data.socials, 0) +
      ";\n\n" +
      "const UI = " +
      jsVal(data.ui || {}, 0) +
      ";\n";
    const blob = new Blob([out], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); // 用 Blob 生成临时下载地址
    a.download = "data.js";
    a.click();
    URL.revokeObjectURL(a.href); // 释放临时地址
    refreshHint("已导出 data.js，覆盖到 assets/js/data.js 即可。");
    toast("已导出 data.js");
  }

  /* ---------- 备份 / 恢复 ---------- */
  // 打开备份弹窗：列出 data.js 的 Git 提交历史（每次保存都是一次提交，天然备份）
  async function openBackups() {
    const modal = $("#backupModal");
    const list = $("#backupList");
    list.innerHTML = '<p class="backup-empty">正在加载 Git 历史…</p>';
    modal.hidden = false;
    document.body.classList.add("is-locked"); // 锁定背景滚动
    try {
      const r = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/commits?path=" + GH_DATA_PATH + "&per_page=20");
      if (r.status === 401) { closeBackups(); toast("Token 失效，请重新登录"); logout(); return; }
      const commits = r.json || [];
      if (!commits.length) {
        list.innerHTML = '<p class="backup-empty">还没有历史提交。</p>';
        return;
      }
      list.innerHTML = "";
      commits.forEach((c) => {
        const row = el("div", "backup-row");
        const info = el("div");
        const nm = el("div", "backup-name");
        nm.textContent = (c.commit && c.commit.message ? c.commit.message : "(无说明)").split("\n")[0];
        const sz = el("div", "backup-size");
        sz.textContent = (c.commit && c.commit.author && c.commit.author.date ? c.commit.author.date.replace("T", " ").slice(0, 19) : "");
        info.appendChild(nm); info.appendChild(sz);
        const btn = el("button", "btn btn-ghost btn-sm");
        btn.type = "button"; btn.textContent = "恢复";
        btn.addEventListener("click", () => restoreBackup(c.sha));
        row.appendChild(info); row.appendChild(btn);
        list.appendChild(row);
      });
    } catch (e) {
      list.innerHTML = '<p class="backup-empty">加载失败，无法连接 GitHub。</p>';
    }
  }
  function closeBackups() {
    $("#backupModal").hidden = true;
    document.body.classList.remove("is-locked");
  }
  // 用某次历史提交里的 data.js 覆盖当前内容（覆盖前 GitHub 也会保留当前版本作为新提交）
  async function restoreBackup(sha) {
    if (!confirm("确定用这份历史版本覆盖当前内容吗？覆盖前 GitHub 也会保留当前版本作为一次新提交。")) {
      return;
    }
    try {
      const r = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH + "?ref=" + sha);
      if (r.status !== 200 || !r.json) { toast("读取该版本失败"); return; }
      const text = base64ToUtf8(r.json.content);
      const data = parseDataJs(text);
      const put = {
        message: "content: restore from history " + sha.slice(0, 8),
        content: utf8ToBase64(buildDataJs(data)),
        branch: GH_BRANCH,
        sha: currentSha,
      };
      let pr = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH, { method: "PUT", body: put });
      if (pr.status === 409) { await fetchDataJs(); put.sha = currentSha; pr = await ghApi("/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + GH_DATA_PATH, { method: "PUT", body: put }); }
      if (pr.status >= 200 && pr.status < 300) {
        if (pr.json && pr.json.content) currentSha = pr.json.content.sha;
        await loadContent();
        renderAll();
        refreshHint("已恢复历史版本，并重新载入内容。");
        toast("✓ 已恢复历史版本");
        closeBackups();
      } else {
        toast("恢复失败(" + pr.status + ")");
      }
    } catch (e) {
      toast("恢复失败：网络错误");
    }
  }

  // 绑定底部「保存」「恢复备份」「导出」按钮
  $("#saveBtn").addEventListener("click", save);
  $("#backupBtn").addEventListener("click", openBackups);
  $("#backupCloseBtn").addEventListener("click", closeBackups);
  $("#backupModal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeBackups();
  });
  $("#previewCloseBtn").addEventListener("click", closeDocPreview);
  $("#previewModal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-preview-close")) closeDocPreview();
  });
  $("#exportBtn").addEventListener("click", exportFile);

  /* ---------- 快捷键与「未保存」提醒 ---------- */
  // Ctrl+S / Cmd+S 直接保存；Esc 关闭备份弹窗
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      if (!adminPanel.hidden) save();
    }
    if (e.key === "Escape") {
      const m = $("#backupModal");
      if (m && !m.hidden) closeBackups();
      const p = $("#previewModal");
      if (p && !p.hidden) closeDocPreview();
    }
  });
  // 有未保存更改时，关闭/刷新页面前弹浏览器确认
  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  // 任何输入/改动都标记为「未保存」（事件委托，动态新增的条目也覆盖）
  adminPanel.addEventListener("input", markDirty);
  adminPanel.addEventListener("change", markDirty);

  /* ---------- 选项卡切换 ---------- */
  // 点某个 tab：清除其它激活态，激活当前 tab 对应的面板
  $$(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".tab-pane").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $(".tab-pane[data-pane='" + t.dataset.tab + "']").classList.add("active");
    });
  });

  /* ---------- 启动：若会话里存了 token 则自动进入后台 ---------- */
  (async function boot() {
    try {
      const saved = (function () { try { return sessionStorage.getItem("anhuann_gh_token"); } catch (e) { return ""; } })();
      if (saved) {
        try { await loginWithToken(saved, true); }
        catch (e) { forgetToken(); }
      }
    } catch (e) {
      /* 未登录或无法连接，停留在登录页 */
    }
  })();
})();
