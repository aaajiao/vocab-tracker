import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// 默认仅本机可达；容器/LAN 调试显式开启，并只允许列出的自定义主机名。
const devLanEnabled = process.env.VITE_DEV_LAN === '1'
const devAllowedHosts = (process.env.VITE_DEV_ALLOWED_HOSTS || '')
  .split(',').map(host => host.trim()).filter(Boolean)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon-light.png', 'apple-touch-icon-dark.png'],
      manifest: {
        name: '词汇本',
        short_name: '词汇本',
        description: 'AI 驱动的多语言词汇学习应用',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#f59e0b',
        orientation: 'portrait-primary',
        id: '/',
        scope: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // 预缓存静态资源
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // 运行时缓存策略
        runtimeCaching: [
          {
            // Google Fonts 样式
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Google Fonts 字体文件
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ],
        // 离线回退页面
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: {
        enabled: false // 开发时禁用 Service Worker
      }
    })
  ],
  // ===========================================
  // Development Server Configuration
  // 开发服务器配置
  // ===========================================
  // Note: These settings only affect `bun run dev` / `npm run dev`.
  // They do NOT affect Vercel production deployment.
  // 注意：以下配置仅影响开发服务器，不影响 Vercel 生产部署。
  // ===========================================
  server: {
    host: devLanEnabled ? '0.0.0.0' : '127.0.0.1',
    allowedHosts: devAllowedHosts,

    // OpenAI API proxy (development only)
    // Vercel uses rewrites in vercel.json for production
    // OpenAI API 代理（仅开发环境）
    // Vercel 生产环境使用 vercel.json 中的 rewrites 配置
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ''),
        secure: true
      }
    }
  }
})
