// Vercel 代理：把后台对 GitHub API 的请求中转出去，解决国内直连 api.github.com 不稳定/被拦截的问题。
// 部署：放到仓库根目录的 api/proxy.js，Vercel 会自动部署为函数，地址形如 https://<项目>.vercel.app/api/proxy.js
// 后台调用方式：GET/PUT/POST  https://<项目>.vercel.app/api/proxy.js?target=<经过 encodeURIComponent 的 GitHub 路径(含查询)>
// 本代理只转发、不存 token（token 仍由浏览器发送）；路径白名单避免被当成通用代理滥用。
const BASE = "https://api.github.com";

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    cors(res);
    res.status(204).end();
    return;
  }
  cors(res);

  const url = new URL(req.url, "http://localhost");
  const target = url.searchParams.get("target") || "/";

  // 路径白名单：仅放行仓库文件内容与 /user
  const allowed = [/^\/repos\/[^\/]+\/[^\/]+\/contents\//, /^\/user$/];
  if (!allowed.some((re) => re.test(target))) {
    res.status(403).send("path not allowed");
    return;
  }
  if (!["GET", "PUT", "POST"].includes(req.method)) {
    res.status(405).send("method not allowed");
    return;
  }

  const ghUrl = BASE + target;
  const headers = { "User-Agent": "anhuann-proxy" };
  for (const k of ["authorization", "content-type", "accept"]) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }

  const body =
    req.method === "GET" || req.method === "OPTIONS"
      ? undefined
      : await getRawBody(req);

  try {
    const r = await fetch(ghUrl, {
      method: req.method,
      headers,
      body: body || undefined,
    });
    const text = await r.text();
    res.status(r.status);
    res.send(text);
  } catch (e) {
    res.status(502).send("proxy error: " + e.message);
  }
};
