---
description: 用 Bun 启动开发服务器（支持多项目）
argument-hint: "<project-path> [--port PORT]"
---

启动开发服务器：

**参数解析**：
- `$ARGUMENTS` 格式：`<project-path> [--port PORT]`
- 默认端口：5173

**执行步骤**：

1. 解析项目路径和端口参数
2. 从路径提取项目名：`/workspace/vocab-tracker` → `vocab-tracker`
3. 会话名：`omo-dev-{项目名}`
4. 检查 `{project-path}/package.json` 是否存在
5. 如果会话已存在，先用 `kill-session` 停止
6. 创建会话并启动服务器

**tmux 命令**（使用 interactive_bash）：

```bash
# 检查会话是否存在（用 bash 检查返回码）
tmux has-session -t omo-dev-{name} 2>/dev/null

# 停止旧会话
kill-session -t omo-dev-{name}

# 创建新会话
new-session -d -s omo-dev-{name} -c {project-path}

# 启动服务器（如有自定义端口）
send-keys -t omo-dev-{name} 'PORT={port} bun run dev' Enter

# 等待 2 秒后检查输出
# 用 bash: sleep 2 && tmux capture-pane -t omo-dev-{name} -p
```

**输出格式**：

```
🟢 开发服务器已启动

| 项目 | vocab-tracker |
|------|---------------|
| 会话 | omo-dev-vocab-tracker |
| 地址 | http://localhost:5173 |
| 命令 | bun run dev |
```

失败时显示 🔴 和错误信息。
