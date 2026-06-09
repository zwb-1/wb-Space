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
SYNC_SECRET=一串足够长的随机字符
LIBRETRANSLATE_URL=你的 LibreTranslate 地址
LIBRETRANSLATE_API_KEY=你的 LibreTranslate key
EASYSCHOLAR_SECRET_KEY=你的 EasyScholar Open API SecretKey
EASYSCHOLAR_USERNAME=你的 EasyScholar 登录账号（备用）
EASYSCHOLAR_PASSWORD=你的 EasyScholar 登录密码（备用）
EASYSCHOLAR_COOKIE=你的 EasyScholar 登录 Cookie（备用，不推荐优先使用）
EASYSCHOLAR_MAX_LOOKUPS=20
```

8. Deploy 完成后，打开 Render 给你的公网 URL。

如果服务已经通过 Blueprint 创建过，后续新增的 `sync: false` 密钥变量可能不会自动写入现有服务，需要进入 Render Dashboard → paper-pulse-web → Environment 手动新增同名变量后再 redeploy。

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

- 收藏、评分、笔记可以通过设置页的同步账号在电脑和手机之间同步。
- Render 免费实例的文件存储可能随重启/重新部署丢失。长期保存建议后续接入数据库。
- 不要把 `.env` 提交到 GitHub。API Key 应该填到云平台的环境变量里。
- EasyScholar SecretKey/账号密码/Cookie 属于你的账号凭据，只能放在 Render 环境变量中，不要提交到仓库；优先使用 SecretKey，不占用网页登录态。
