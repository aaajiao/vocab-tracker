---
description: 停止开发服务器
argument-hint: "<project-name | all>"
---

停止开发服务器：

**参数**：
- 项目名（如 `vocab-tracker`）→ 停止单个项目
- `all` → 停止所有开发服务器

**执行步骤**：

1. **停止单个项目**：
   ```bash
   # 使用 interactive_bash
   kill-session -t omo-dev-{project-name}
   ```

2. **停止所有项目**（`$ARGUMENTS` = "all"）：
   ```bash
   # 先用 bash 获取会话列表
   tmux list-sessions 2>/dev/null | grep "omo-dev-" | cut -d: -f1
   
   # 对每个会话使用 interactive_bash
   kill-session -t {session-name}
   ```

**输出格式**：

```
🛑 已停止开发服务器

| 会话 | 状态 |
|------|------|
| omo-dev-vocab-tracker | 已停止 |
```

如果会话不存在，提示用户。
