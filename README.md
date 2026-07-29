# 禾味点菜

一个面向手机使用的中文点菜应用，使用原生 HTML、CSS、JavaScript 开发。支持菜单分类与搜索、规格备注、已点菜单、桌号人数、菜单确认、本地持久化、PWA 安装与离线访问，并可通过 Capacitor 打包为 Android 应用。应用不展示价格，适合轻松地记录“今天想吃什么”。

## 本地开发

要求 Node.js 18 或更高版本。

1. 安装依赖：`npm install`
2. 将 `.env.example` 复制为 `.env.local`，填写 RDS 连接信息。不要提交该文件。
3. 启动 API：`npm run dev:api`
4. 在另一个终端启动前端：`npm run dev`
5. 生成生产版本：`npm run build`
6. 生产运行：`npm start`

浏览器开发模式不会启用完整的 Service Worker 行为。请使用生产预览验证安装和离线功能。在 Chrome/Edge 地址栏或应用菜单中选择“安装应用”。

## 打包 Android

需要提前安装 Android Studio、Android SDK 与受支持的 JDK。

首次创建 Android 工程：

1. 运行 `npm run android:add`
2. 运行 `npm run android:sync`
3. 运行 `npm run android:open`

以后网页代码有变化时，仅需运行 `npm run android:sync`，然后在 Android Studio 中运行或生成 APK/AAB。

## 数据说明

- 菜单从 MySQL 读取，新增菜品和确认订单通过服务端 API 写入 MySQL。
- 已点菜单、桌号与用餐人数仍保存在浏览器 `localStorage` 中，供离线回退使用。
- 离线确认的订单会暂存在当前设备，并在应用下次启动或网络恢复时自动补传；订单号唯一约束可防止重复入库。
- 浏览器本地开发通过 Vite 代理访问 API；Android 包必须通过 `VITE_API_URL` 指向已部署的 HTTPS API，不能直接连接 RDS。
- 部署 API 时通过 `ALLOWED_ORIGINS` 配置允许的网页来源，多个来源使用逗号分隔；默认允许 Capacitor 的 `https://localhost` 与 `http://localhost`。
- 菜品图片使用在线示例图，并配置了加载失败占位与 PWA 运行时缓存。正式使用前建议替换为餐厅自有图片。

## 常用配置

- PWA 与缓存策略：`vite.config.js`
- Android 应用 ID 和构建目录：`capacitor.config.json`
- 菜品与业务交互：`main.js`
- 响应式界面：`style.css`