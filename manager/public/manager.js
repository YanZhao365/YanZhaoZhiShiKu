let data;
let currentSection = null;
let currentArticle = null;
let dirty = false;
let aiConfig = { configured: false, model: "deepseek-flash" };
let aiSuggestion = null;
let aiChatHistory = [];
try {
  const savedChat = JSON.parse(localStorage.getItem("yanzhao-private-ai-chat") || "[]");
  if (Array.isArray(savedChat)) aiChatHistory = savedChat.slice(-30);
} catch { aiChatHistory = []; }

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[character]);
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const toast = (message, duration = 3000) => {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), duration);
};

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const value = await response.json().catch(() => ({ ok: false, error: `请求失败（${response.status}）` }));
  if (!response.ok || value.ok === false) throw new Error(value.details || value.error || `请求失败（${response.status}）`);
  return value;
}

async function load() {
  data = await requestJson("/api/data");
  currentSection = data.sections[0]?.id || null;
  render();
  await loadAiConfig();
}

function mark() {
  dirty = true;
  $("#saveState").textContent = "有尚未保存的修改";
}

function render() {
  $("#sections").innerHTML = data.sections.map((section, index) => `
    <div class="row ${section.id === currentSection ? "active" : ""}">
      <button data-section="${escapeHtml(section.id)}">${escapeHtml(section.title)}</button>
      <span class="tools">
        <button data-up="${index}" title="上移">↑</button>
        <button data-down="${index}" title="下移">↓</button>
        <button data-rename="${escapeHtml(section.id)}" title="重命名">✎</button>
      </span>
    </div>`).join("");
  $("#sectionId").innerHTML = data.sections.map((section) => `<option value="${escapeHtml(section.id)}">${escapeHtml(section.title)}</option>`).join("");
  renderArticles();
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.onclick = () => { currentSection = button.dataset.section; currentArticle = null; render(); };
  });
  document.querySelectorAll("[data-up]").forEach((button) => { button.onclick = () => move(Number(button.dataset.up), -1); });
  document.querySelectorAll("[data-down]").forEach((button) => { button.onclick = () => move(Number(button.dataset.down), 1); });
  document.querySelectorAll("[data-rename]").forEach((button) => { button.onclick = () => renameSection(button.dataset.rename); });
}

function renderArticles() {
  const section = data.sections.find((item) => item.id === currentSection);
  $("#articleHeading").textContent = section?.title || "文章";
  const articles = data.articles.filter((article) => article.sectionId === currentSection);
  $("#articles").innerHTML = articles.length ? articles.map((article) => `
    <button class="article-item ${article.id === currentArticle ? "active" : ""}" data-article="${escapeHtml(article.id)}">
      <b>${escapeHtml(article.title || "未命名文章")}</b>
      <small>${escapeHtml(article.updatedAt || "尚未保存")}</small>
    </button>`).join("") : '<div class="empty">这个目录还没有文章</div>';
  document.querySelectorAll("[data-article]").forEach((button) => { button.onclick = () => openArticle(button.dataset.article); });
  if (!currentArticle) {
    $("#editorForm").hidden = true;
    $("#emptyEditor").hidden = false;
  }
}

function openArticle(id) {
  currentArticle = id;
  const article = data.articles.find((item) => item.id === id);
  $("#emptyEditor").hidden = true;
  $("#editorForm").hidden = false;
  $("#title").value = article.title || "";
  $("#sectionId").value = article.sectionId;
  $("#summary").value = article.summary || "";
  $("#body").value = article.body || "";
  renderArticles();
}

function sync() {
  if (!currentArticle) return;
  const article = data.articles.find((item) => item.id === currentArticle);
  article.title = $("#title").value.trim() || "未命名文章";
  article.sectionId = $("#sectionId").value;
  article.summary = $("#summary").value.trim();
  article.body = $("#body").value;
  article.updatedAt = new Date().toLocaleDateString("zh-CN");
  currentSection = article.sectionId;
  mark();
  renderArticles();
}

function move(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= data.sections.length) return;
  [data.sections[index], data.sections[target]] = [data.sections[target], data.sections[index]];
  mark();
  render();
}

function renameSection(id) {
  const section = data.sections.find((item) => item.id === id);
  const name = prompt("请输入新的目录名称", section.title);
  if (!name?.trim()) return;
  section.title = name.trim();
  const description = prompt("请输入目录说明", section.description || "");
  if (description !== null) section.description = description.trim();
  mark();
  render();
}

async function save() {
  sync();
  await requestJson("/api/data", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  dirty = false;
  $("#saveState").textContent = "已保存到电脑";
  toast("已保存");
}

async function loadAiConfig() {
  try {
    aiConfig = await requestJson("/api/ai-config");
    updateAiStatus();
  } catch (error) {
    $("#aiStatus").textContent = "配置读取失败";
    toast(error.message);
  }
}

function updateAiStatus() {
  $("#aiStatus").textContent = aiConfig.configured ? "DeepSeek 已配置 · 发布前需人工确认" : "尚未配置 API 密钥";
  $("#aiKeyHint").textContent = aiConfig.configured ? `已保存本地密钥（${aiConfig.maskedKey || "已隐藏"}），留空可保持不变` : "尚未保存密钥";
  $("#aiModel").value = aiConfig.model || "deepseek-flash";
}

$("#addSection").onclick = () => {
  const title = prompt("请输入新目录名称");
  if (!title?.trim()) return;
  const section = { id: uid("section"), title: title.trim(), description: "等待添加内容。" };
  data.sections.push(section);
  currentSection = section.id;
  mark();
  render();
};

$("#addArticle").onclick = () => {
  if (!currentSection) return toast("请先创建一个目录");
  const article = { id: uid("article"), sectionId: currentSection, title: "新文章", summary: "", body: "", updatedAt: new Date().toLocaleDateString("zh-CN") };
  data.articles.push(article);
  currentArticle = article.id;
  mark();
  render();
  openArticle(article.id);
};

["#title", "#summary", "#body"].forEach((selector) => $(selector).addEventListener("input", sync));
$("#sectionId").addEventListener("change", sync);

$("#deleteArticle").onclick = () => {
  if (!currentArticle || !confirm("确定删除这篇文章吗？")) return;
  data.articles = data.articles.filter((article) => article.id !== currentArticle);
  currentArticle = null;
  mark();
  renderArticles();
};

$("#fileInput").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) return toast("附件超过25MB，请压缩后重试");
  $("#uploadState").textContent = "正在保存附件……";
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const result = await requestJson("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, data: reader.result }),
      });
      $("#body").value += `\n\n[${file.name}](${result.path})`;
      sync();
      $("#uploadState").textContent = "附件已加入文章";
      toast("附件保存成功");
    } catch (error) { toast(error.message); }
  };
  reader.readAsDataURL(file);
};

$("#saveButton").onclick = () => save().catch((error) => toast(error.message));
$("#publishButton").onclick = async () => {
  try {
    await save();
    $("#publishButton").textContent = "正在发布……";
    $("#publishButton").disabled = true;
    const result = await requestJson("/api/publish", { method: "POST" });
    toast(result.message);
  } catch (error) {
    toast(`发布未完成：${error.message}`, 5000);
  } finally {
    $("#publishButton").textContent = "一键发布";
    $("#publishButton").disabled = false;
  }
};

$("#aiSettingsButton").onclick = () => {
  $("#aiApiKey").value = "";
  updateAiStatus();
  $("#aiSettingsDialog").showModal();
};

document.querySelectorAll("[data-close]").forEach((button) => {
  button.onclick = () => $(`#${button.dataset.close}`).close();
});

$("#saveAiSettings").onclick = async () => {
  const button = $("#saveAiSettings");
  try {
    button.disabled = true;
    button.textContent = "正在保存……";
    aiConfig = await requestJson("/api/ai-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: $("#aiApiKey").value.trim(), model: $("#aiModel").value }),
    });
    updateAiStatus();
    $("#aiSettingsDialog").close();
    toast("DeepSeek 设置已保存在本机");
  } catch (error) {
    toast(error.message, 5000);
  } finally {
    button.disabled = false;
    button.textContent = "保存设置";
  }
};

$("#aiOrganizeButton").onclick = async () => {
  if (!currentArticle) return toast("请先选择一篇文章");
  if (!aiConfig.configured) {
    toast("请先点击顶部“AI 设置”填写 DeepSeek API 密钥");
    $("#aiSettingsButton").click();
    return;
  }
  const rawBody = $("#body").value.trim();
  if (rawBody.length < 10) return toast("请先在正文中粘贴至少10个字的原始笔记");
  const button = $("#aiOrganizeButton");
  try {
    button.disabled = true;
    button.textContent = "AI 正在整理……";
    const result = await requestJson("/api/ai/organize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: $("#title").value,
        summary: $("#summary").value,
        body: rawBody,
        sectionId: $("#sectionId").value,
        sections: data.sections.map(({ id, title, description }) => ({ id, title, description })),
      }),
    });
    aiSuggestion = result.suggestion;
    $("#aiPreviewTitle").textContent = aiSuggestion.title;
    $("#aiPreviewSummary").textContent = aiSuggestion.summary;
    $("#aiPreviewBody").textContent = aiSuggestion.body;
    $("#aiPreviewSection").textContent = data.sections.find((section) => section.id === aiSuggestion.recommendedSectionId)?.title || "保持当前目录";
    $("#aiUsage").textContent = result.usage?.total_tokens ? `本次共使用 ${result.usage.total_tokens.toLocaleString("zh-CN")} Token` : "用量以 DeepSeek 控制台账单为准";
    $("#aiPreviewDialog").showModal();
  } catch (error) {
    toast(`AI 整理失败：${error.message}`, 6000);
  } finally {
    button.disabled = false;
    button.textContent = "✦ AI 整理文章";
  }
};

$("#applyAiSuggestion").onclick = () => {
  if (!aiSuggestion) return;
  $("#title").value = aiSuggestion.title;
  $("#summary").value = aiSuggestion.summary;
  $("#body").value = aiSuggestion.body;
  if (data.sections.some((section) => section.id === aiSuggestion.recommendedSectionId)) $("#sectionId").value = aiSuggestion.recommendedSectionId;
  sync();
  $("#aiPreviewDialog").close();
  toast("AI 建议已应用，请检查后保存");
};

function saveChatHistory() {
  localStorage.setItem("yanzhao-private-ai-chat", JSON.stringify(aiChatHistory.slice(-30)));
}

function renderAiChat(pending = false) {
  const messages = $("#aiChatMessages");
  messages.replaceChildren();
  if (!aiChatHistory.length && !pending) {
    const welcome = document.createElement("div");
    welcome.className = "chat-welcome";
    welcome.textContent = "这是只属于你的本地 AI 助手。它可以结合知识库回答问题、解释学习内容和起草文章，但无权直接修改或发布网站。";
    messages.append(welcome);
  }
  aiChatHistory.forEach((message) => {
    const row = document.createElement("div");
    row.className = `chat-message ${message.role}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = message.content;
    row.append(bubble);
    messages.append(row);
  });
  if (pending) {
    const row = document.createElement("div");
    row.className = "chat-message assistant pending";
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = "DeepSeek 正在思考……";
    row.append(bubble);
    messages.append(row);
  }
  messages.scrollTop = messages.scrollHeight;
}

function currentDraftForChat() {
  if (!currentArticle || $("#editorForm").hidden) return null;
  return {
    title: $("#title").value.slice(0, 200),
    summary: $("#summary").value.slice(0, 1000),
    body: $("#body").value.slice(0, 30000),
  };
}

$("#aiChatButton").onclick = () => {
  if (!aiConfig.configured) {
    toast("请先配置 DeepSeek API 密钥");
    $("#aiSettingsButton").click();
    return;
  }
  renderAiChat();
  $("#aiChatDialog").showModal();
  setTimeout(() => $("#aiChatInput").focus(), 50);
};

$("#clearAiChat").onclick = () => {
  if (aiChatHistory.length && !confirm("确定清空本机保存的 AI 对话吗？")) return;
  aiChatHistory = [];
  saveChatHistory();
  renderAiChat();
  $("#aiChatState").textContent = "对话已清空 · AI 无权直接修改或发布网站";
};

async function sendAiChat() {
  const input = $("#aiChatInput");
  const content = input.value.trim();
  if (!content) return;
  if (content.length > 4000) return toast("单次提问不能超过 4,000 字");
  const button = $("#sendAiChat");
  aiChatHistory.push({ role: "user", content });
  aiChatHistory = aiChatHistory.slice(-30);
  saveChatHistory();
  input.value = "";
  button.disabled = true;
  $("#aiChatState").textContent = "正在连接 DeepSeek……";
  renderAiChat(true);
  try {
    const result = await requestJson("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: aiChatHistory.slice(-12),
        mode: $("#aiChatMode").value,
        currentDraft: currentDraftForChat(),
      }),
    });
    aiChatHistory.push({ role: "assistant", content: result.message });
    aiChatHistory = aiChatHistory.slice(-30);
    saveChatHistory();
    const tokens = result.usage?.total_tokens;
    $("#aiChatState").textContent = tokens ? `本次使用 ${tokens.toLocaleString("zh-CN")} Token · 内容仅保存在本机` : "回答完成 · 内容仅保存在本机";
    renderAiChat();
  } catch (error) {
    $("#aiChatState").textContent = "回答失败，请检查网络或余额";
    renderAiChat();
    toast(`AI 对话失败：${error.message}`, 6000);
  } finally {
    button.disabled = false;
    input.focus();
  }
}

$("#sendAiChat").onclick = sendAiChat;
$("#aiChatInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!$("#sendAiChat").disabled) sendAiChat();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (dirty) { event.preventDefault(); event.returnValue = ""; }
});

load().catch((error) => toast(`读取失败：${error.message}`, 5000));
