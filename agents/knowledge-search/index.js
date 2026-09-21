function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function searchTavily(apiKey, query, maxResults) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
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
      include_published_date: true,
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
    const error = new Error(known[response.status] || `Tavily 搜索失败（${response.status}）`);
    error.status = response.status;
    throw error;
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
  return { results, usage: payload.usage || { credits: 1 } };
}

async function lookupOpenLibrary(query) {
  const compactIsbn = query.replace(/[^0-9Xx]/g, "");
  const isIsbn = /^(?:\d{9}[\dXx]|\d{13})$/.test(compactIsbn);
  const searchQuery = isIsbn ? `isbn:${compactIsbn.toUpperCase()}` : query;
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,isbn,publisher,language,cover_i,edition_count,number_of_pages_median,subject");
  const response = await fetch(url.toString(), { headers: { "user-agent": "YanZhaoKnowledgeBase/1.0" } });
  if (!response.ok) throw new Error(`Open Library 查询失败（${response.status}）`);
  const payload = await response.json().catch(() => ({}));
  return (Array.isArray(payload.docs) ? payload.docs : []).slice(0, 5).map((book) => {
    const isbns = Array.isArray(book.isbn) ? book.isbn.map(String) : [];
    const isbn = (isIsbn && isbns.includes(compactIsbn.toUpperCase()) ? compactIsbn.toUpperCase() : isbns.find((value) => value.length === 13) || isbns[0] || "");
    const key = String(book.key || "");
    const coverId = Number(book.cover_i) || 0;
    return {
      title: String(book.title || "").slice(0, 200),
      authors: (Array.isArray(book.author_name) ? book.author_name : []).slice(0, 8).map(String),
      publishers: (Array.isArray(book.publisher) ? [...new Set(book.publisher.map(String))] : []).slice(0, 6),
      firstPublishYear: Number(book.first_publish_year) || null,
      isbn,
      languages: (Array.isArray(book.language) ? book.language : []).slice(0, 8).map(String),
      pages: Number(book.number_of_pages_median) || null,
      editionCount: Number(book.edition_count) || null,
      subjects: (Array.isArray(book.subject) ? book.subject : []).slice(0, 12).map(String),
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "",
      sourceUrl: key ? `https://openlibrary.org${key}` : "https://openlibrary.org",
    };
  }).filter((book) => book.title);
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ ok: false, error: "仅支持 POST 请求" }, 405);

  const expectedSecret = String(context.env.YANZHAO_AGENT_SECRET || "");
  const requestHeaders = context.request.headers || {};
  const objectHeader = Object.entries(requestHeaders).find(([name]) => name.toLowerCase() === "x-yanzhao-agent-secret")?.[1];
  const suppliedSecret = String(
    typeof requestHeaders.get === "function"
      ? requestHeaders.get("x-yanzhao-agent-secret")
      : objectHeader || ""
  );
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ ok: false, error: "未授权" }, 401);

  let input;
  try {
    if (typeof context.request.json === "function") input = await context.request.json();
    else if (typeof context.request.body === "string") input = JSON.parse(context.request.body);
    else input = context.request.body || {};
  }
  catch { return json({ ok: false, error: "请求内容不是有效 JSON" }, 400); }

  const query = String(input.query || "").trim().slice(0, 300);
  if (query.length < 2) return json({ ok: false, error: "搜索内容太短" }, 400);
  const maxResults = Math.min(Math.max(Number(input.maxResults) || 6, 1), 8);
  const mode = input.mode === "book" ? "book" : "search";
  const tavilyApiKey = String(context.env.TAVILY_API_KEY || "").trim();
  if (!tavilyApiKey) return json({ ok: false, error: "尚未配置 TAVILY_API_KEY" }, 500);

  try {
    const tavilyQuery = mode === "book" ? `${query} 图书 作者 出版社 内容简介 目录 书评` : query;
    const [search, books] = await Promise.all([
      searchTavily(tavilyApiKey, tavilyQuery, maxResults),
      mode === "book" ? lookupOpenLibrary(query).catch(() => []) : Promise.resolve([]),
    ]);
    return json({ ok: true, results: search.results, books, usage: search.usage });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Tavily 联网搜索失败" }, Number(error?.status) || 500);
  }
}
