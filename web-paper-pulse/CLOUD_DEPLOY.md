# 云端部署 Paper Pulse Web

这个网页应用是一个普通 Node.js Web 服务。云平台需要运行：

```bash
npm start
```

服务会自动读取平台提供的 `PORT`，并监听 `0.0.0.0`。

## 推荐路径：Render

1. 把整个项目推送到 GitHub。
2. 登录 Render，选择 New → Web Service。
3. 选择这个 GitHub 仓库。
4. Root Directory 填：

```text
web-paper-pulse
```

5. Build Command 填：

```bash
npm install --omit=dev
```

6. Start Command 填：

```bash
npm start
```

7. Environment Variables 可选填写：

```text
OPENALEX_MAILTO=你的邮箱
CORE_API_KEY=你的 CORE key
SEMANTIC_SCHOLAR_API_KEY=你的 Semantic Scholar key
```

8. Deploy 完成后，打开 Render 给你的公网 URL。

## Railway / Zeabur

这两个平台也可以部署。选择 GitHub 仓库后，把服务根目录设为：

```text
web-paper-pulse
```

启动命令：

```bash
npm start
```

如果选择 Docker 部署，平台会使用本目录的 `Dockerfile`。

## 注意

- 收藏、评分、笔记目前保存在浏览器本地。电脑和手机会各有一份数据。
- 如果你想电脑和手机收藏同步，需要后续加数据库和登录。
- 不要把 `.env` 提交到 GitHub。API Key 应该填到云平台的环境变量里。
