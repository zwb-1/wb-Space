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

默认启用 OpenAlex 和 arXiv。Crossref、PubMed、Hugging Face Daily、Google Scholar、超星学术可直接勾选。CORE 和 Semantic Scholar 需要把 key 写入 `.env`：

```text
CORE_API_KEY=你的_CORE_KEY
SEMANTIC_SCHOLAR_API_KEY=你的_SEMANTIC_SCHOLAR_KEY
```

保存后重启 `node server.js`。

## 数据

收藏、评分、笔记和偏好默认保存在浏览器本地。设置页可以导出或导入 JSON。

## 新功能

- 账号同步：设置页登录/创建账号后，电脑和手机会同步收藏、笔记、设置、翻译缓存和期刊指标表。
- 翻译：列表会自动生成标题/摘要中英对照，点击论文卡片可在原位置展开阅读；默认优先使用 Microsoft/Google 免费翻译链，MyMemory 仅最后兜底。
- 影响因子/分区筛选：默认按 SCI 2 区 / Q2 及以上筛选已知指标的期刊；未知指标默认保留，严格模式会隐藏未知指标。
- 指标导入：设置页下载 CSV 模板，填入 `journal, issn, impactFactor, quartile, partition, year, source` 后导入。
- EasyScholar：优先在云平台环境变量配置官方 Open API 的 `EASYSCHOLAR_SECRET_KEY`，服务端会按期刊名从 EasyScholar 查询并缓存影响因子/分区；`EASYSCHOLAR_COOKIE` 仅作为备用方式。未配置时使用手动导入表。

官方 JCR 影响因子和 SCI 分区通常是授权数据，本项目不会内置或伪造这些值。请导入你自己有权限使用的 JCR/中科院/SCI 分区表。
