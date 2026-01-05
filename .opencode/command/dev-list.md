---
description: 列出所有运行中的开发服务器
---

列出所有运行中的开发服务器：

**执行步骤**：

1. 获取所有 `omo-dev-*` 会话：
   ```bash
   tmux list-sessions 2>/dev/null | grep "omo-dev-"
   ```

2. 对每个会话提取访问地址：
   ```bash
   tmux capture-pane -t {session-name} -p | grep -oE "http://[^ ]+" | head -1
   ```

**输出格式**：

```
📋 运行中的开发服务器

| 项目 | 会话 | 地址 |
|------|------|------|
| vocab-tracker | omo-dev-vocab-tracker | http://localhost:5173 |
| my-api | omo-dev-my-api | http://localhost:3000 |
```

如果没有运行中的服务器：

```
📋 没有运行中的开发服务器

使用 `/dev <project-path>` 启动
```
