# 乐梵小灶

一个面向手机使用的中文点菜应用，使用原生 HTML、CSS、JavaScript 开发。支持菜单分类与搜索、规格备注、已点菜单、菜单确认、PWA 安装，并可通过 Capacitor 打包为 Android 应用。应用不展示价格，适合轻松地记录“今天想吃什么”。

## 本地开发

要求 Node.js 18 或更高版本。

1. 安装依赖：`npm install`
2. 将 `.env.example` 复制为 `.env.local`，填写 RDS 连接信息。不要提交该文件。
3. 启动 API：`npm run dev:api`
4. 在另一个终端启动前端：`npm run dev`
5. 生成生产版本：`npm run build`
6. 生产运行：`npm start`

浏览器开发模式不会启用完整的 Service Worker 行为。请使用生产预览验证安装功能。在 Chrome/Edge 地址栏或应用菜单中选择“安装应用”。

## 打包 Android

需要提前安装 Android Studio、Android SDK 与受支持的 JDK。

首次创建 Android 工程：

1. 运行 `npm run android:add`
2. 运行 `npm run android:sync`
3. 运行 `npm run android:open`

以后网页代码有变化时，仅需运行 `npm run android:sync`，然后在 Android Studio 中运行或生成 APK/AAB。

## 数据说明

- 菜品、菜品规格、已确认菜单和订单全部以 MySQL 数据为准，浏览器和 Android 应用不持久化业务数据。
- 当前尚未确认的点菜选择仅存在页面内存中；刷新或关闭应用后会重新读取数据库中的最新已确认菜单。
- 新增、修改、删除菜品或确认菜单只有在数据库写入成功后才会显示成功。离线或服务不可用时会提示重试，不会生成本地替代记录。
- 其他设备会在应用启动、恢复到前台、打开“已点”页或最多约 10 秒后读取数据库中的最新已确认菜单。
- 浏览器本地开发通过 Vite 代理访问 API；Android 包必须通过 `VITE_API_URL` 指向已部署的 HTTPS API，不能直接连接 RDS。
- 部署 API 时通过 `ALLOWED_ORIGINS` 配置允许的网页来源，多个来源使用逗号分隔；默认允许 Capacitor 的 `https://localhost` 与 `http://localhost`。
- 菜品图片地址保存在数据库中，并配置了加载失败占位与 PWA 运行时缓存。正式使用前建议使用餐厅自有图片。

## 常用配置

- PWA 与缓存策略：`vite.config.js`
- Android 应用 ID 和构建目录：`capacitor.config.json`
- 菜品与业务交互：`main.js`
- 响应式界面：`style.css`


后续我只负责修改前端界面、后端代码和业务逻辑，构建、测试、同步等命令由你自己执行。

# 前端开发（Vite 热更新）
npm run dev

# 后端 API（Express + MySQL）
npm run dev:api

# 生产启动（同时提供 API 和前端静态文件）
npm start

# 运行测试
npm test

# 生产构建（Vite + PWA 生成 dist/）
npm run build

# 本地预览生产构建
npm run preview

# Android 打包
npm run android:sync      # 构建并同步到 Android 工程
npm run android:open      # 在 Android Studio 中打开