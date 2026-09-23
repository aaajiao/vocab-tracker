import { handleRequest } from './api';

// 仅绑定回环地址；Vite 的 /api/v1 代理转发到这里。
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.API_PORT || 3001), fetch: handleRequest });
console.log(`学习 API 已启动：http://127.0.0.1:${server.port}/api/v1`);
