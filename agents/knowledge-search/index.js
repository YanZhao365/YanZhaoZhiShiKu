function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ ok: false, error: "仅支持 POST 请求" }, 405);

  const expectedSecret = String(context.env.YANZHAO_AGENT_SECRET || "");
  const suppliedSecret = String(context.request.headers.get("x-yanzhao-agent-secret") || "");
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ ok: false, error: "未授权" }, 401);

  let input;
  try { input = await context.request.json(); }
  catch { return json({ ok: false, error: "请求内容不是有效 JSON" }, 400); }

  const query = String(input.query || "").trim().slice(0, 300);
  if (query.length < 2) return json({ ok: false, error: "搜索内容太短" }, 400);
  const maxResults = Math.min(Math.max(Number(input.maxResults) || 6, 1), 8);
  const tavilyApiKey = String(context.env.TAVILY_API_KEY || "").trim();
  if (!tavilyApiKey) return json({ ok: false, error: "尚未配置 TAVILY_API_KEY" }, 500);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${tavilyApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        topic: "general",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_usage: true,
        safe_search: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const known = {
        401: "Tavily API Key 无效",
        429: "Tavily 请求过于频繁，请稍后重试",
        432: "Tavily 免费额度已用完",
        433: "Tavily 用量已达到设置上限",
      };
      return json({ ok: false, error: known[response.status] || `Tavily 搜索失败（${response.status}）` }, response.status);
    }
    const results = Array.isArray(payload.results) ? payload.results.slice(0, maxResults).map((item) => {
      let site = "";
      try { site = new URL(String(item.url || "")).hostname; } catch {}
      return {
        title: String(item.title || "").slice(0, 200),
        href: String(item.url || "").slice(0, 2000),
        snippet: String(item.content || "").slice(0, 1200),
        site: site.slice(0, 200),
        date: String(item.published_date || "").slice(0, 100),
      };
    }).filter((item) => item.title && /^https?:\/\//i.test(item.href)) : [];
    return json({ ok: true, results, usage: payload.usage || { credits: 1 } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Tavily 联网搜索失败" }, 500);
  }
}
