# 沿昭的知识库【YanZhao】

这是沿昭的个人知识库网站与电脑端管理器。

## 日常使用

1. 双击 `启动沿昭知识库管理器.cmd`。
2. 在浏览器管理页面中修改目录和文章。
3. 点击“保存”将内容保存在电脑中。
4. 点击“一键发布”提交到 GitHub；连接 EdgeOne 后，线上网站会自动更新。

电脑只需在修改和发布时开机。网站部署成功后，电脑关机不影响访问。

## 管理员联网研究

管理器支持通过 EdgeOne Agents 的 `web_search` 搜索互联网，再由 DeepSeek 生成带来源的文章建议。搜索结果只会显示在本机管理器中，必须由管理员确认后才能应用、保存和发布。

首次启用需要在 EdgeOne 项目的环境变量中配置：

- `WSA_API_KEY`：腾讯云联网搜索 API 的服务密钥。
- `YANZHAO_AGENT_SECRET`：管理员自行生成的至少 24 位随机密钥。

随后在本机管理器的“AI 设置”中填写相同的 `YANZHAO_AGENT_SECRET`。不要把任何密钥写入 GitHub 仓库或公开页面。

腾讯云联网搜索 WSA 独立计费，EdgeOne Agent 的免费运行额度不等于 WSA 搜索免费。

## 首次部署

- GitHub 仓库：`YanZhao365/YanZhaoZhiShiKu`
- EdgeOne 构建命令：留空
- EdgeOne 输出目录：`/`
