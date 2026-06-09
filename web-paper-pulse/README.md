# Paper Pulse Web

本目录是一个独立网页版文献阅读工具，适合先在电脑浏览器个人使用。

## 启动

```powershell
cd "D:\科研\科研文献小程序\web-paper-pulse"
node server.js
```

打开：

```text
http://localhost:8787
```

也可以双击 `start-web.bat`。

## 来源

默认启用 OpenAlex 和 arXiv。Crossref、PubMed、Hugging Face Daily 可直接勾选。CORE 和 Semantic Scholar 需要把 key 写入 `.env`：

```text
CORE_API_KEY=你的_CORE_KEY
SEMANTIC_SCHOLAR_API_KEY=你的_SEMANTIC_SCHOLAR_KEY
```

保存后重启 `node server.js`。

## 数据

收藏、评分、笔记和偏好保存在浏览器本地。设置页可以导出或导入 JSON。
