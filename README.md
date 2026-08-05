# 乐梵小灶

一个面向手机使用的中文点菜应用，使用原生 HTML、CSS、JavaScript 开发。支持菜单分类与搜索、规格备注、已点菜单、菜单确认、PWA 安装，并可通过 Capacitor 打包为 Android 应用。应用不展示价格，适合轻松地记录“今天想吃什么”。

## 本地开发

要求 Node.js 18 或更高版本。

1. 安装依赖：`npm install`
2. 将 `.env.example` 复制为 `.env.local`，填写 RDS 连接信息。不要提交该文件。
3. 启动前后端（Vite + Express 同时运行）：`npm run dev`
4. 仅后端 API：`npm run dev:api`
5. 生成生产版本：`npm run build`
6. 生产运行：`npm start`

浏览器开发模式不会启用完整的 Service Worker 行为。请使用生产预览验证安装功能。在 Chrome/Edge 地址栏或应用菜单中选择"安装应用"。

## 服务器部署

后端 API 通过 PM2 部署在 `118.89.135.164` 的 `/opt/hewei-order` 目录。

### 上传后端代码

```bash
# 将 server/ 目录上传到服务器（替换为实际 SSH 信息）
scp -r server/* ubuntu@118.89.135.164:/opt/hewei-order/server/
```

### 登录服务器操作

```bash
ssh ubuntu@118.89.135.164

# 进入项目目录
cd /opt/hewei-order

# 重新安装依赖（如果 package.json 有变化）
npm install --production

# 重启 API 服务
pm2 restart hewei-api

# 查看日志
pm2 logs hewei-api

# 查看服务状态
pm2 status
```

### 变更说明

| 改了什么 | 需要做什么 |
|---------|-----------|
| `server/` 后端代码 | 上传到服务器并 `pm2 restart hewei-api` |
| 前端 HTML/CSS/JS | 运行 `npm run android:sync` 重新打包 APK |
| `package.json` 依赖 | 服务器上也需执行 `npm install --production` |

## 打包 Android

需要提前安装 Android Studio、Android SDK 与受支持的 JDK。

首次创建 Android 工程：

1. 运行 `npm run android:add`
2. 运行 `npm run android:sync`
3. 运行 `npm run android:open`

以后网页代码有变化时，仅需运行 `npm run android:sync`，然后在 Android Studio 中运行或生成 APK/AAB。

**无 Android Studio 直接用命令行打包 APK：**

```bash
npm run android:sync
cd android && .\gradlew.bat assembleDebug
```

APK 文件位于 `android/app/build/outputs/apk/debug/`。

## 数据说明

- 菜品、菜品规格、收藏、已确认菜单和订单全部以 MySQL 数据为准，浏览器和 Android 应用不持久化业务数据。
- 当前尚未确认的点菜选择仅存在页面内存中；刷新或关闭应用后会重新读取数据库中的当前已确认菜单。清空已点菜单会在数据库中取消当前菜单，并同步到其他设备。
- 新增、修改、删除菜品或确认菜单只有在数据库写入成功后才会显示成功。离线或服务不可用时会提示重试，不会生成本地替代记录。
- 其他设备会在应用启动、恢复到前台、打开“已点”页或最多约 10 秒后读取数据库中的当前已确认菜单。
- 浏览器本地开发通过 Vite 代理访问 API；Android 包必须通过 `VITE_API_URL` 指向已部署的 HTTPS API，不能直接连接 RDS。
- 部署 API 时通过 `ALLOWED_ORIGINS` 配置允许的网页来源，多个来源使用逗号分隔；默认允许 Capacitor 的 `https://localhost` 与 `http://localhost`。
- 菜品图片地址保存在数据库中，并配置了加载失败占位与 PWA 运行时缓存。正式使用前建议使用餐厅自有图片。

## 常用配置

- PWA 与缓存策略：`vite.config.js`
- Android 应用 ID 和构建目录：`capacitor.config.json`
- 菜品与业务交互：`main.js`
- 响应式界面：`style.css`


后续只负责修改前端界面、后端代码和业务逻辑，构建、测试、同步等命令不需要执行。