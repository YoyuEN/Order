# 禾味点菜

一个面向手机使用的中文点菜应用，使用原生 HTML、CSS、JavaScript 开发。支持菜单分类与搜索、规格备注、已点菜单、桌号人数、菜单确认、本地持久化、PWA 安装与离线访问，并可通过 Capacitor 打包为 Android 应用。应用不展示价格，适合轻松地记录“今天想吃什么”。

## 本地开发

要求 Node.js 18 或更高版本。

1. 安装依赖：`npm install`
2. 启动开发服务器：`npm run dev`
3. 生成生产版本：`npm run build`
4. 预览生产版本与 PWA：`npm run preview`

浏览器开发模式不会启用完整的 Service Worker 行为。请使用生产预览验证安装和离线功能。在 Chrome/Edge 地址栏或应用菜单中选择“安装应用”。

## 打包 Android

需要提前安装 Android Studio、Android SDK 与受支持的 JDK。

首次创建 Android 工程：

1. 运行 `npm run android:add`
2. 运行 `npm run android:sync`
3. 运行 `npm run android:open`

以后网页代码有变化时，仅需运行 `npm run android:sync`，然后在 Android Studio 中运行或生成 APK/AAB。

## 数据说明

- 已点菜单、自定义菜品、桌号与用餐人数保存在浏览器 `localStorage` 中。
- 当前下单流程为本地演示实现；接入真实餐厅时，应将菜单、库存和订单提交替换为后端 API。
- 菜品图片使用在线示例图，并配置了加载失败占位与 PWA 运行时缓存。正式使用前建议替换为餐厅自有图片。

## 常用配置

- PWA 与缓存策略：`vite.config.js`
- Android 应用 ID 和构建目录：`capacitor.config.json`
- 菜品与业务交互：`main.js`
- 响应式界面：`style.css`