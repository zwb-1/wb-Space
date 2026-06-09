# 论文速读微信小程序

这是一个独立的微信小程序工程，融合了 `arxiv_daily_paper_push`、`paper-daily` 和 `Paper-Tracker` 的核心优点：

- 多来源获取论文：Hugging Face Daily Papers、ArXiv、OpenAlex、Crossref、PubMed / PMC、CORE、Semantic Scholar
- 研究画像：核心关键词、必须命中词、排除词、研究重点
- 自动去重：按 DOI、arXiv ID 和标题合并多来源结果
- 兴趣评分：标题命中、摘要命中、必须命中、排除词、引用/来源加权，生成 1-5 星
- 文献库：刷新后自动沉淀到本地，最多保留 500 篇
- 报告：可复制 Markdown 日报、年度概览、研究方向地图
- DeepSeek 解读：生成结构化中文分析，API Key 放在微信云函数环境变量里

没有接入 Sci-Hub。它没有官方 API，而且存在法律风险；这个小程序只接入官方或正规公开 API。

## 打开方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择：`D:\科研\科研文献小程序\wechat-miniprogram`
4. AppID 可以先用测试号，正式自用时换成你自己的小程序 AppID。

## 云函数配置

如需使用 DeepSeek 解读、CORE 或 Semantic Scholar：

1. 在微信开发者工具中开通云开发。
2. 修改 `miniprogram/utils/config.js` 的 `cloudEnv` 为你的云环境 ID，或留空使用当前环境。
3. 上传并部署：
   - `cloudfunctions/analyzePaper`
   - `cloudfunctions/searchPapers`
4. 在云函数环境变量里按需设置：

```text
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
DEEPSEEK_MODEL=deepseek-chat
CORE_API_KEY=你的 CORE API Key
SEMANTIC_SCHOLAR_API_KEY=你的 Semantic Scholar API Key
```

## 请求域名

真机体验版需要在小程序后台配置 request 合法域名：

```text
https://huggingface.co
https://export.arxiv.org
https://api.openalex.org
https://api.crossref.org
https://eutils.ncbi.nlm.nih.gov
https://api.deepseek.com
https://arxiv.paperswithcode.com
https://api.core.ac.uk
https://api.semanticscholar.org
```

开发阶段也可以在微信开发者工具中临时勾选“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。

## 使用建议

1. 先在首页刷新，确认 Hugging Face、ArXiv、OpenAlex 能返回论文。
2. 进入设置页，调整“研究画像”的关键词和排除词。
3. 回首页切到“推荐”，看高分论文是否符合你的方向。
4. 点进论文详情，使用“解读”生成 DeepSeek 中文分析。
5. 进入报告页，复制日报、年度概览或方向地图。
