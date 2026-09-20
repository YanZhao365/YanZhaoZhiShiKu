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

  try {
    const webSearch = context.tools.get("web_search");
    const results = await webSearch.execute({ query, maxResults });
    return json({ ok: true, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "联网搜索失败" }, 500);
  }
}
