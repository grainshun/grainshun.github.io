/* =========================================================
 * Anhuann · 前台交互脚本（main.js）
 * ---------------------------------------------------------
 * 负责把内容渲染到页面，并处理导航、主题切换、文章弹窗、
 * 社交卡片复制、滚动入场动画等全部交互。一般不需要改这个文件。
 *
 * 内容来源（动态）：
 *   优先 fetch('/api/content') 拿服务器里的实时内容；
 *   若没有服务器（直接双击 index.html），则回退使用 data.js 里的全局变量。
 *   这一层在 loadContent() 里处理（见文件末尾）。
 *
 * 安全约定：所有来自数据的内容在插入 HTML 前都经 escapeHtml() 转义，
 *   只有 body 这类「允许富文本」的字段才保留标签（用于简单排版与 LaTeX）。
 * ========================================================= */

// IIFE（立即执行函数）包裹，避免污染全局作用域
(function () {
  "use strict"; // 严格模式，规范书写，减少隐式错误

  // 两个极简选择器： $(选择器) 取单个，$$(选择器) 取数组（便于遍历）
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- 图标库（Feather 风格线性图标） ---------- */
  // 每个图标是一段 SVG 内部路径（不含外层 <svg>）。三种特殊前缀：
  //   FILL:  → 用 fill="currentColor" 实心填充（如 X、抖音）
  //   TEXT:  → 用文字字形替代（如知乎「知」）
  //   其它  → 默认描边风格（stroke），线条更细
  const ICONS = {
    github:
      '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
    mail: '<rect x="2" y="4.5" width="20" height="15" rx="2.5"/><path d="m3 7 9 6 9-6"/>',
    x:
      'FILL:<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/>',
    wechat:
      '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/><path d="M8.5 10.5h.01M15.5 10.5h.01"/>',
    bilibili:
      '<rect x="2" y="4" width="20" height="15" rx="3"/><path d="M8.5 2.5 11 7M15.5 2.5 13 7"/><path d="M7.5 11.5v2.5M16.5 11.5v2.5"/>',
    zhihu: "TEXT:知",
    douyin:
      'FILL:<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.11-3.58 0-5.37-.01-1.61-.02-3.21-.02-4.81 0-.61.19-1.2.58-1.62.37-.39.84-.57 1.36-.61.04-.01.08-.02.13-.02z"/>',
    rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.2" fill="currentColor" stroke="none"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    external:
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    arrowRight:
      '<line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/>',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'
  };

  // 把图标名转成完整 <svg> 字符串；找不到就用 globe 兜底
  function icon(name) {
    const raw = ICONS[name] || ICONS.globe;
    if (raw.indexOf("FILL:") === 0) {
      // 实心风格：fill 用 currentColor，自动跟随文字颜色
      return (
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        raw.slice(5) +
        "</svg>"
      );
    }
    if (raw.indexOf("TEXT:") === 0) {
      // 文字字形风格（如知乎「知」）：用 <text> 渲染一个汉字
      return (
        '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="17.5" text-anchor="middle" ' +
        'font-size="15" font-weight="700" fill="currentColor">知</text></svg>'
      );
    }
    // 默认描边风格：stroke + 圆角线帽，Feather 风格
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      raw +
      "</svg>"
    );
  }

  /* ---------- 小工具 ---------- */
  // HTML 转义：防止数据里的 < > & " ' 破坏页面结构或被注入脚本
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 短日期：2026-09-28 -> 2026.09.28（用于文章列表、卡片）
  function formatDate(dateStr) {
    const parts = String(dateStr).split("-");
    if (parts.length !== 3) return dateStr;
    return parts[0] + "." + parts[1] + "." + parts[2];
  }

  // 长日期：2026-09-28 -> 2026 年 9 月 28 日（用于文章弹窗标题）
  function formatDateLong(dateStr) {
    const parts = String(dateStr).split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[0]} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日`;
  }

  // 把 [颜色1, 颜色2] 转成 CSS 渐变；缺色时回退到主题强调色
  function gradient(colors) {
    if (!colors || !colors.length) return "linear-gradient(135deg, var(--accent), var(--accent-2))";
    if (colors.length === 1) return colors[0];
    return `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
  }

  /* ---------- 轻提示（toast） ---------- */
  // 页面底部自动出现的小提示，2 秒后淡出；复用同一个 .toast 节点
  let toastTimer = null;
  function toast(message) {
    let el = $(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2000);
  }

  // 复制文本到剪贴板：优先用现代 Clipboard API（需 HTTPS/localhost），
  // 否则用 textarea + execCommand 兜底（兼容 file:// 双击打开的情况）
  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        () => toast("已复制：" + text),
        () => toast(fallback() ? "已复制：" + text : "复制失败，请手动选择")
      );
    } else {
      toast(fallback() ? "已复制：" + text : "复制失败，请手动选择");
    }
  }

  /* ---------- 主题切换（深 / 浅色） ---------- */
  function initTheme() {
    const root = document.documentElement; // <html> 元素，data-theme 挂在这里
    const saved = localStorage.getItem("anhuann-theme"); // 用户上次的选择
    const prefersDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    // 优先级：已保存 > 系统偏好 > 默认浅色
    const theme = saved || (prefersDark ? "dark" : "light");
    root.setAttribute("data-theme", theme);

    // 同步移动端地址栏颜色
    const meta = $('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#1D1A18" : "#e9f1fb");
    }

    // 点切换按钮：在 dark/light 间翻转并持久化
    $("#themeToggle").addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("anhuann-theme", next);
      if (meta) meta.setAttribute("content", next === "dark" ? "#1D1A18" : "#FAF7F2");
    });
  }

  /* ---------- 站点基础信息（首屏 / 品牌 / 页脚） ---------- */
  function initSite() {
    document.title = `${SITE.name} · 个人主页`;

    // 顶部品牌与首屏头像占位文字（取首字母）
    $("#brandText").textContent = SITE.name;
    $("#brandMarkText").textContent = SITE.initial || SITE.name.charAt(0);
    $("#heroAvatarText").textContent = SITE.initial || SITE.name.charAt(0);

    // 若配置了头像图片：加载图片，加载失败则回退到首字母占位
    if (SITE.avatar) {
      ["heroAvatarImg", "brandMarkImg"].forEach((id) => {
        const img = document.getElementById(id);
        if (!img) return;
        const fb = document.getElementById(id.replace("Img", "Text")); // 对应的文字占位
        img.onerror = () => {
          img.hidden = true;
          if (fb) fb.hidden = false;
        };
        img.src = SITE.avatar;
        img.hidden = false;
        if (fb) fb.hidden = true;
      });
    }

    // 首屏文案
    $("#heroGreeting").textContent = SITE.greeting;
    $("#heroName").textContent = SITE.name;
    $("#heroTagline").textContent = SITE.tagline;
    $("#heroDesc").textContent = SITE.description;

    // 首页邮箱卡片
    const mailto = "mailto:" + SITE.email;
    $("#mailCard").href = mailto;
    $("#mailValue").textContent = SITE.email;
    $("#mailIcon").innerHTML = icon("mail");
    $("#mailArrow").innerHTML = icon("arrowRight");

    // 页脚版权
    $("#footerCopy").textContent =
      `© ${new Date().getFullYear()} ${SITE.name} · ${SITE.footerNote}`;
  }

  /* ---------- 界面文案（来自 data.js 的 UI 区块） ---------- */
  // 安全设置文本：取不到值就保留 HTML 里的默认文字（保证旧内容/缺字段时不空白）
  function setText(sel, val) {
    if (val == null) return;
    const node = $(sel);
    if (node) node.textContent = val;
  }
  function initUI() {
    const u = typeof UI !== "undefined" && UI ? UI : {};

    // SEO：描述 + 关键词（关键词没有该 meta 就现场创建）
    const desc = $("#metaDesc");
    if (desc && u.metaDescription) desc.setAttribute("content", u.metaDescription);
    if (u.metaKeywords) {
      let kw = $('meta[name="keywords"]');
      if (!kw) {
        kw = document.createElement("meta");
        kw.name = "keywords";
        document.head.appendChild(kw);
      }
      kw.setAttribute("content", u.metaKeywords);
    }

    // 导航与手机菜单：按 data-nav 批量填充（同一段文字两处共用）
    if (u.nav) {
      $$("[data-nav]").forEach((a) => {
        const t = u.nav[a.dataset.nav];
        if (t) a.textContent = t;
      });
    }

    // 首屏两个按钮 + 底部滚动提示（无障碍文字）
    setText("#heroPrimaryBtn", u.hero && u.hero.primaryBtn);
    setText("#heroGhostBtn", u.hero && u.hero.ghostBtn);
    const hint = $("#scrollHint");
    if (hint && u.hero && u.hero.scrollHint) hint.setAttribute("aria-label", u.hero.scrollHint);

    // 三个板块的小标签 / 标题 / 副标题
    setText("#aboutKicker", u.about && u.about.kicker);
    setText("#aboutTitle", u.about && u.about.title);
    setText("#aboutSub", u.about && u.about.sub);
    setText("#blogKicker", u.blog && u.blog.kicker);
    setText("#blogTitle", u.blog && u.blog.title);
    setText("#blogSub", u.blog && u.blog.sub);
    setText("#postsEmpty", u.blog && u.blog.emptyHint); // 文章为空时的提示
    setText("#contactKicker", u.contact && u.contact.kicker);
    setText("#contactTitle", u.contact && u.contact.title);
    setText("#contactSub", u.contact && u.contact.sub);

    // 作者状态：首页 hero 区展示的近况/更新频率，后台「界面文案」可改
    setText("#authorStatus", u.authorStatus);
  }

  /* ---------- 数学公式渲染（KaTeX） ---------- */
  // 把 scope 容器内的 $...$ / $$...$$ 等标记为数学公式交给 KaTeX 渲染。
  // 库由 index.html 通过 assets/vendor/katex 本地引入（离线可用）。
  function renderMath(scope) {
    if (scope && window.renderMathInElement) {
      try {
        window.renderMathInElement(scope, {
          delimiters: [
            { left: "$$", right: "$$", display: true },   // 块级公式
            { left: "$", right: "$", display: false },    // 行内公式
            { left: "\\(", right: "\\)", display: false }, // 备选行内写法
            { left: "\\[", right: "\\]", display: true }   // 备选块级写法
          ],
          throwOnError: false // 公式写错时不在页面抛错，只标红该处
        });
      } catch (e) {}
    }
  }

  /* ---------- 关于我 ---------- */
  function initAbout() {
    // 引入语（板块副标题由 initUI 按 UI.about.sub 填充）
    $("#aboutIntro").innerHTML = `<p>${escapeHtml(ABOUT.intro)}</p>`;

    // 「全部展开 / 收起」开关，放在故事卡上方，方便一次性操作全部卡片
    $("#aboutIntro").insertAdjacentHTML(
      "afterend",
      '<div class="about-actions">' +
        '<button class="about-toggle-all" id="aboutToggleAll" type="button">全部收起</button>' +
      "</div>"
    );

    // 5 张主题故事卡：编号徽章 + 可点击展开的标题 + 折叠的正文
    // 默认全部收起：加 collapsed 类 + aria-expanded="false"，点标题才展开
    const list = $("#storyList");
    list.innerHTML = ABOUT.themes
      .map((t, i) => {
        const body = (Array.isArray(t.body) ? t.body : [t.body])
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join("");
        return (
          `<article class="story-block reveal collapsed">` +
          `<span class="story-num">${i + 1}</span>` +
          `<div class="story-content">` +
          // 标题做成按钮触发器：点一下展开/收起正文，箭头指示状态
          `<h3 class="story-title">` +
          `<button class="story-head" type="button" aria-expanded="false">` +
          `<span class="story-head-text">${escapeHtml(t.title)}</span>` +
          `<span class="story-toggle" aria-hidden="true"></span>` +
          `</button></h3>` +
          // 折叠容器：用 grid 行高 1fr/0fr 过渡实现平滑收起
          `<div class="story-collapse"><div class="story-collapse-inner">` +
          `<div class="story-body">${body}</div>` +
          `</div></div>` +
          `</div></article>`
        );
      })
      .join("");

    // 单卡展开/收起：事件委托，点标题切换该卡收起状态
    list.addEventListener("click", (e) => {
      const head = e.target.closest(".story-head");
      if (!head) return;
      const art = head.closest(".story-block");
      const collapsed = art.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
      updateToggleAll();
    });

    // 全部展开/收起：只要还有展开的就全部收起，否则全部展开
    const allBtn = $("#aboutToggleAll");
    if (allBtn) {
      allBtn.addEventListener("click", () => {
        const anyOpen = list.querySelector(".story-block:not(.collapsed)");
        const collapse = !!anyOpen;
        list.querySelectorAll(".story-block").forEach((art) => {
          art.classList.toggle("collapsed", collapse);
          const h = art.querySelector(".story-head");
          if (h) h.setAttribute("aria-expanded", String(!collapse));
        });
        updateToggleAll();
      });
    }

    // 同步「全部展开/收起」按钮文案
    function updateToggleAll() {
      const btn = $("#aboutToggleAll");
      if (!btn) return;
      const anyOpen = list.querySelector(".story-block:not(.collapsed)");
      btn.textContent = anyOpen ? "全部收起" : "全部展开";
    }
    updateToggleAll();

    // 故事卡里若含公式，渲染之
    renderMath(list);
  }

  /* ---------- 博客列表 ---------- */
  function initPosts() {
    const list = $("#postList");
    const empty = $("#postsEmpty");

    // 没有文章时隐藏列表、显示空提示
    if (!POSTS.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    // 渲染每篇文章为一颗可点击的「卡片按钮」，点击打开弹窗
    list.innerHTML = POSTS.map((p, i) => {
      const tags = (p.tags || [])
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join("");
      return (
        `<button class="post-item reveal" type="button" data-index="${i}" ` +
        `style="transition-delay:${Math.min(i, 4) * 60}ms">` + // 前几张错峰淡入
        `<span class="post-date">${formatDate(p.date)}</span>` +
        `<span class="post-main">` +
        `<span class="post-title">${escapeHtml(p.title)}</span>` +
        `<span class="post-excerpt">${escapeHtml(p.excerpt || "")}</span>` +
        `<span class="post-tags">${tags}</span>` +
        `</span>` +
        `<span class="post-arrow">${icon("arrowRight")}</span>` +
        `</button>`
      );
    }).join("");

    // 列表点击委托：找到被点的卡片，按 data-index 打开对应文章
    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".post-item");
      if (!btn) return;
      openPost(Number(btn.dataset.index));
    });
  }

  /* ---------- 极简 Markdown 渲染（与后台预览保持一致） ---------- */
  function escapeHtmlstr(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
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
  function miniMarkdown(src) {
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      let m = line.match(/^(#{1,3})\s+(.*)$/);
      if (m) {
        const lv = m[1].length;
        html += "<h" + lv + ">" + mdInline(escapeHtmlstr(m[2])) + "</h" + lv + ">";
        i++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        html += "<blockquote>" + mdInline(escapeHtmlstr(buf.join(" "))) + "</blockquote>";
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          buf.push("<li>" + mdInline(escapeHtmlstr(lines[i].replace(/^[-*]\s+/, ""))) + "</li>");
          i++;
        }
        html += "<ul>" + buf.join("") + "</ul>";
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          buf.push("<li>" + mdInline(escapeHtmlstr(lines[i].replace(/^\d+\.\s+/, ""))) + "</li>");
          i++;
        }
        html += "<ol>" + buf.join("") + "</ol>";
        continue;
      }
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
    return html;
  }

  /* ---------- 文章弹窗 ---------- */
  let lastFocused = null; // 记住打开弹窗前聚焦的元素，关闭后归还焦点（无障碍）

  // 打开第 index 篇文章的弹窗
  function openPost(index) {
    const post = POSTS[index];
    if (!post) return;

    lastFocused = document.activeElement;
    $("#modalDate").textContent = formatDateLong(post.date);
    $("#modalTags").innerHTML = (post.tags || [])
      .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
      .join("");
    $("#modalTitle").textContent = post.title;
    // 正文：按 Markdown 渲染（与后台预览一致），保留 $...$ 公式
    const bodySrc = Array.isArray(post.body) ? post.body.join("\n") : String(post.body || "");
    $("#modalBody").innerHTML = miniMarkdown(bodySrc);

    renderMath($("#modalBody")); // 弹窗正文里的公式也渲染

    const modal = $("#postModal");
    modal.hidden = false;
    document.body.classList.add("is-locked"); // 锁定背景滚动
    $("#modalClose").focus(); // 焦点移到关闭按钮
  }

  // 关闭弹窗
  function closePost() {
    const modal = $("#postModal");
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove("is-locked");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  // 绑定弹窗的关闭交互：点关闭按钮 / 点遮罩 / 按 Esc
  function initModal() {
    $("#modalClose").addEventListener("click", closePost);
    $("#postModal").addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close")) closePost();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePost();
        closeMobileMenu();
      }
    });
  }

  /* ---------- 社交链接 ---------- */
  // 顶部/页脚用的小图标药丸（只含图标、无文字）
  function socialIconPill(s) {
    return (
      `<a class="social-pill" href="${escapeHtml(s.url || "#")}" ` +
      `title="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}" ` +
      `${s.url && s.url !== "#" ? 'target="_blank" rel="noopener"' : ""}>` +
      icon(s.icon) +
      `</a>`
    );
  }

  // 渲染所有社交入口：首屏小图标、页脚小图标、联系区卡片
  function initSocials() {
    // 邮箱不是「外链图标」，单独从图标药丸里排除，只放到联系卡片区
    const clickable = SOCIALS.filter((s) => s.icon !== "mail");

    // 首屏最多放 5 个图标；页脚放全部
    $("#heroSocials").innerHTML = clickable.slice(0, 5).map(socialIconPill).join("");
    $("#footerLinks").innerHTML = clickable.map(socialIconPill).join("");

    // 联系区：每个社交一张卡片（徽章色 + 名称 + 账号）
    $("#socialGrid").innerHTML = SOCIALS.map((s) => {
      const href = s.url || "#";
      const external = s.url && s.url.indexOf("http") === 0; // 是否为外链
      return (
        `<a class="social-card" href="${escapeHtml(href)}" data-copy="${s.copy ? "1" : "0"}" ` +
        `data-value="${escapeHtml(s.handle || "")}" ` +
        `${external ? 'target="_blank" rel="noopener"' : ""}>` +
        `<span class="social-badge" style="background:${gradient(s.color)}">${icon(s.icon)}</span>` +
        `<span class="social-meta">` +
        `<span class="social-name">${escapeHtml(s.name)}</span>` +
        `<span class="social-handle">${escapeHtml(s.handle || "")}</span>` +
        `</span></a>`
      );
    }).join("");

    // 没有链接、或标记「点击复制」的卡片：点一下就复制账号，不跳转
    $("#socialGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".social-card");
      if (!card) return;
      const href = card.getAttribute("href");
      if ((card.dataset.copy === "1" || href === "#") && card.dataset.value) {
        e.preventDefault();
        copyText(card.dataset.value);
      }
    });
  }

  /* ---------- 导航 ---------- */
  // 关闭移动端下拉菜单（幂等：已关则直接返回）
  function closeMobileMenu() {
    const menu = $("#mobileMenu");
    const btn = $("#menuBtn");
    if (!menu.classList.contains("is-open")) return;
    menu.classList.remove("is-open");
    btn.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  function initNav() {
    const btn = $("#menuBtn");
    // 汉堡按钮：开关移动端菜单并同步 aria 状态
    btn.addEventListener("click", () => {
      const menu = $("#mobileMenu");
      const open = !menu.classList.contains("is-open");
      menu.classList.toggle("is-open", open);
      btn.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    });

    // 点任意移动端菜单项后自动收起
    $$(".mobile-link").forEach((link) => link.addEventListener("click", closeMobileMenu));

    const header = $("#siteHeader");
    const bar = $("#progressBar"); // 顶部阅读进度条
    const toTop = $("#toTop");     // 回到顶部按钮
    const links = $$(".nav-link"); // 桌面导航链接
    const ids = ["home", "about", "blog", "contact"]; // 用于滚动高亮的板块顺序

    // 用 rAF 节流滚动事件，避免高频触发造成卡顿
    let ticking = false;
    function onScroll() {
      const y = window.scrollY || window.pageYOffset;

      // 顶栏滚动后变「吸顶」样式；超过一屏才显示回到顶部
      header.classList.toggle("is-stuck", y > 8);
      toTop.classList.toggle("is-visible", y > 480);

      // 阅读进度条：当前滚动 / 可滚动总高
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      bar.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";

      // 滚动高亮：找出当前视口顶部所在的板块，点亮对应导航项
      const offset = y + 140;
      let current = ids[0];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= offset) current = id;
      });
      links.forEach((a) =>
        a.classList.toggle("active", a.getAttribute("href") === "#" + current)
      );

      revealFallback(); // 滚动时顺带处理还没显现的入场动画元素
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(onScroll);
        }
      },
      { passive: true } // 声明不阻止默认滚动，提升性能
    );
    onScroll(); // 首屏先跑一次，初始化高亮/进度

    // 回到顶部：平滑滚动
    toTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- 滚动入场动画 ---------- */
  // 待显现的元素集合；用于兜底：当 IntersectionObserver 因快速滚动/锚点跳转
  // 而漏掉某些元素时，在每次滚动里手动把它们点亮。
  let pendingReveal = [];

  function revealFallback() {
    if (!pendingReveal.length) return;
    const line = window.innerHeight - 40; // 视口底部上移 40px 的判定线
    pendingReveal = pendingReveal.filter((el) => {
      if (el.getBoundingClientRect().top < line) {
        el.classList.add("is-visible"); // 进入判定线即显现
        return false;
      }
      return true;
    });
    fillToolBars();
  }

  // 初始化入场动画：优先用 IntersectionObserver 监听进入视口；
  // 不支持的浏览器直接全部显现（保证内容可见）。
  function initReveal() {
    const items = $$(".reveal");
    pendingReveal = items.slice();
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      pendingReveal = [];
      fillToolBars();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target); // 显现后停止观察，省资源
            const i = pendingReveal.indexOf(entry.target);
            if (i > -1) pendingReveal.splice(i, 1);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    items.forEach((el) => io.observe(el));

    // 技能条（.tool-bar）动画：旧版「技能栈」的残留逻辑，无对应元素时为无操作。
    // 保留以向后兼容，若以后加回技能展示即可自动生效。
    const bars = $$(".tool-bar");
    if (bars.length) {
      const bio = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              fillToolBars();
              bio.disconnect();
            }
          });
        },
        { threshold: 0.3 }
      );
      bio.observe($(".tool-card"));
    }
  }

  // 把技能条宽度设为 data-level 指定的百分比（见上方说明）
  function fillToolBars() {
    $$(".tool-bar i").forEach((i) => {
      i.style.width = (i.dataset.level || 0) + "%";
    });
  }

  /* ---------- 内容加载：优先服务器 API，失败回退 data.js 全局 ---------- */
  // 动态站点核心：先从 /api/content 取服务器实时内容；
  // 抛错（无服务器 / file:// 模式）则什么也不做，继续用 data.js 的全局变量。
  async function loadContent() {
    try {
      const res = await fetch("/api/content", { credentials: "same-origin" });
      if (!res.ok) throw new Error("content fetch failed");
      const data = await res.json();
      applyData(data);
    } catch (e) {
      /* 无服务器时（直接双击 index.html）使用 data.js 中的全局变量 */
    }
  }

  // 把服务器返回的扁平结构合并进现有全局常量（SITE/ABOUT/POSTS/SOCIALS）
  function applyData(data) {
    if (!data) return;
    if (data.site) Object.assign(SITE, data.site);
    if (data.about) Object.assign(ABOUT, data.about);
    // 数组用「清空后重填」而不是整体替换，避免其它引用失效
    if (Array.isArray(data.posts)) {
      POSTS.length = 0;
      data.posts.forEach((p) => POSTS.push(p));
    }
    if (Array.isArray(data.socials)) {
      SOCIALS.length = 0;
      data.socials.forEach((s) => SOCIALS.push(s));
    }
    // 界面文案：合并进现有 UI 对象（缺字段时保留 data.js 里的默认值）
    if (data.ui && typeof UI !== "undefined") Object.assign(UI, data.ui);
  }

  /* ---------- 启动 ---------- */
  // 页面准备好后依次初始化：先主题，再（异步）拉内容，最后渲染各部分。
  async function init() {
    initTheme();
    await loadContent(); // 等动态内容到位，再做依赖它的渲染
    initUI();
    initSite();
    initAbout();
    initPosts();
    initSocials();
    initModal();
    initNav();
    initReveal();
  }

  // 兼容两种加载时机：DOM 还在解析就等 DOMContentLoaded，否则立即执行
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
