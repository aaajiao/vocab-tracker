# 依赖评估与处理（2026-09-23）

保留 React、Vite、Tailwind、Supabase、Vercel 的现有架构。本轮重点是修复审计命中、统一类型版本、升级构建和测试工具，并确认真实部署兼容性。

| 项目 | 本轮版本 | 处理原因 |
| --- | --- | --- |
| React / React DOM / 类型 | 19.3.0 | 统一运行时与类型的大版本，消除原 React 19 配 React 18 类型的问题 |
| Supabase JS | 2.117.1 | 更新客户端及传递依赖，保留现有登录和数据库接口 |
| Tailwind / Vite 插件 | 4.3.3 | 同步样式工具版本，检查实际手机和桌面渲染 |
| React Virtual | 3.14.13 | 更新虚拟列表依赖，同时修复应用中的滚动偏移计算 |
| Vite / React 插件 | 8.3.0 / 6.1.1 | 升级构建工具，默认仅监听本机，开发代理验证 TLS |
| PWA 插件 / Workbox | 1.3.0 / 7.4.1 | 更新离线缓存工具，验证分块缓存和离线重新打开 |
| Vitest / happy-dom | 5.0.1 / 20.14.5 | 升级测试运行环境，重新运行完整行为回归 |
| TypeScript | 7.0.2 + 6.0.3 API | 默认原生 TS7 检查，同时保留 Vercel 构建所需 TS6 编译器 API |
| Node 类型 / 部署运行时 | 24.13.6 / 24.x | 与 Vercel 部署运行时一致，不改变用户机器的全局 Node |
| Bun / PGlite / fake-indexeddb | 1.4.2 / 0.5.8 / 6.2.5 | 保持已经验证的版本 |

直接依赖固定版本并提交 Bun 锁文件。通过上游兼容发布解决传递依赖问题，没有使用强制跨大版本覆盖。React 和 Supabase 分开打包，避免每次应用修改都使整个依赖包缓存失效。

本轮没有引入新的 UI 库、状态管理框架或单独的语音服务。当前功能不需要这些额外依赖；Codex 继续负责对话与语音，App 负责数据和复习排期。

工具链使用方法与兼容检查见 [toolchain.md](toolchain.md)。升级依据包括 [Vite 迁移文档](https://vite.dev/guide/migration)、[TypeScript 7 说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)、[Vitest 迁移文档](https://vitest.dev/guide/migration/) 和 [Vercel Node 运行时说明](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)。审计结果只代表此次检查时已知的依赖公告，不代表未来不会出现新问题。
