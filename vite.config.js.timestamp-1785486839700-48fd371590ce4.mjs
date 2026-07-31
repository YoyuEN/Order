// vite.config.js
import { defineConfig } from "file:///C:/YoyuEN/Order/node_modules/vite/dist/node/index.js";
import { VitePWA } from "file:///C:/YoyuEN/Order/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/uploads": "http://localhost:3001"
    }
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "\u4E50\u68B5\u5C0F\u7076",
        short_name: "\u79BE\u5473\u4E50\u68B5\u5C0F\u7076\u70B9\u83DC",
        description: "\u624B\u673A\u626B\u7801\u70B9\u83DC\u4E0E\u672C\u5730\u8BA2\u5355\u7BA1\u7406",
        theme_color: "#d94b32",
        background_color: "#f7f4ee",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "zh-CN",
        icons: [
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
        ]
      },
      workbox: {
        navigateFallback: "index.html",
        runtimeCaching: [{
          urlPattern: /^https:\/\/images\.unsplash\.com\//,
          handler: "CacheFirst",
          options: {
            cacheName: "dish-images",
            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] }
          }
        }]
      }
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxZb3l1RU5cXFxcT3JkZXJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFlveXVFTlxcXFxPcmRlclxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovWW95dUVOL09yZGVyL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcclxuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSdcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgc2VydmVyOiB7XHJcbiAgICBwcm94eToge1xyXG4gICAgICAnL2FwaSc6ICdodHRwOi8vbG9jYWxob3N0OjMwMDEnLFxyXG4gICAgICAnL3VwbG9hZHMnOiAnaHR0cDovL2xvY2FsaG9zdDozMDAxJyxcclxuICAgIH0sXHJcbiAgfSxcclxuICBwbHVnaW5zOiBbXHJcbiAgICBWaXRlUFdBKHtcclxuICAgICAgcmVnaXN0ZXJUeXBlOiAnYXV0b1VwZGF0ZScsXHJcbiAgICAgIGluY2x1ZGVBc3NldHM6IFsnaWNvbnMvaWNvbi5zdmcnXSxcclxuICAgICAgbWFuaWZlc3Q6IHtcclxuICAgICAgICBuYW1lOiAnXHU0RTUwXHU2OEI1XHU1QzBGXHU3MDc2JyxcclxuICAgICAgICBzaG9ydF9uYW1lOiAnXHU3OUJFXHU1NDczXHU0RTUwXHU2OEI1XHU1QzBGXHU3MDc2XHU3MEI5XHU4M0RDJyxcclxuICAgICAgICBkZXNjcmlwdGlvbjogJ1x1NjI0Qlx1NjczQVx1NjI2Qlx1NzgwMVx1NzBCOVx1ODNEQ1x1NEUwRVx1NjcyQ1x1NTczMFx1OEJBMlx1NTM1NVx1N0JBMVx1NzQwNicsXHJcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjZDk0YjMyJyxcclxuICAgICAgICBiYWNrZ3JvdW5kX2NvbG9yOiAnI2Y3ZjRlZScsXHJcbiAgICAgICAgZGlzcGxheTogJ3N0YW5kYWxvbmUnLFxyXG4gICAgICAgIG9yaWVudGF0aW9uOiAncG9ydHJhaXQtcHJpbWFyeScsXHJcbiAgICAgICAgc3RhcnRfdXJsOiAnLycsXHJcbiAgICAgICAgc2NvcGU6ICcvJyxcclxuICAgICAgICBsYW5nOiAnemgtQ04nLFxyXG4gICAgICAgIGljb25zOiBbXHJcbiAgICAgICAgICB7IHNyYzogJy9pY29ucy9pY29uLnN2ZycsIHNpemVzOiAnYW55JywgdHlwZTogJ2ltYWdlL3N2Zyt4bWwnLCBwdXJwb3NlOiAnYW55JyB9LFxyXG4gICAgICAgICAgeyBzcmM6ICcvaWNvbnMvaWNvbi1tYXNrYWJsZS5zdmcnLCBzaXplczogJ2FueScsIHR5cGU6ICdpbWFnZS9zdmcreG1sJywgcHVycG9zZTogJ21hc2thYmxlJyB9LFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHdvcmtib3g6IHtcclxuICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrOiAnaW5kZXguaHRtbCcsXHJcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFt7XHJcbiAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2ltYWdlc1xcLnVuc3BsYXNoXFwuY29tXFwvLyxcclxuICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcclxuICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgY2FjaGVOYW1lOiAnZGlzaC1pbWFnZXMnLFxyXG4gICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDMwLCBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzMCB9LFxyXG4gICAgICAgICAgICBjYWNoZWFibGVSZXNwb25zZTogeyBzdGF0dXNlczogWzAsIDIwMF0gfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfV0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSxcclxuICBdLFxyXG59KSJdLAogICJtYXBwaW5ncyI6ICI7QUFBcU8sU0FBUyxvQkFBb0I7QUFDbFEsU0FBUyxlQUFlO0FBRXhCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFFBQVE7QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLFlBQVk7QUFBQSxJQUNkO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsZUFBZSxDQUFDLGdCQUFnQjtBQUFBLE1BQ2hDLFVBQVU7QUFBQSxRQUNSLE1BQU07QUFBQSxRQUNOLFlBQVk7QUFBQSxRQUNaLGFBQWE7QUFBQSxRQUNiLGFBQWE7QUFBQSxRQUNiLGtCQUFrQjtBQUFBLFFBQ2xCLFNBQVM7QUFBQSxRQUNULGFBQWE7QUFBQSxRQUNiLFdBQVc7QUFBQSxRQUNYLE9BQU87QUFBQSxRQUNQLE1BQU07QUFBQSxRQUNOLE9BQU87QUFBQSxVQUNMLEVBQUUsS0FBSyxtQkFBbUIsT0FBTyxPQUFPLE1BQU0saUJBQWlCLFNBQVMsTUFBTTtBQUFBLFVBQzlFLEVBQUUsS0FBSyw0QkFBNEIsT0FBTyxPQUFPLE1BQU0saUJBQWlCLFNBQVMsV0FBVztBQUFBLFFBQzlGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsU0FBUztBQUFBLFFBQ1Asa0JBQWtCO0FBQUEsUUFDbEIsZ0JBQWdCLENBQUM7QUFBQSxVQUNmLFlBQVk7QUFBQSxVQUNaLFNBQVM7QUFBQSxVQUNULFNBQVM7QUFBQSxZQUNQLFdBQVc7QUFBQSxZQUNYLFlBQVksRUFBRSxZQUFZLElBQUksZUFBZSxLQUFLLEtBQUssS0FBSyxHQUFHO0FBQUEsWUFDL0QsbUJBQW1CLEVBQUUsVUFBVSxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsVUFDMUM7QUFBQSxRQUNGLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
