# Codex 学习接入：分阶段交付

数据、权限、复习排期与长期学习记录由 Vocab Tracker 管理；Codex 通过项目 API 组织文字和实时语音练习。不会另建一份本地词库。

## 提交阶段

0. 记录边界、接口契约和验收标准。
1. 数据与 API：用户级访问令牌、词汇/句子/复习查询、练习会话及幂等复习事件，数据库与接口测试。
2. 网页：连接 Codex 的令牌管理、练习历史和学习偏好，页面验证。
3. Codex：可安装的复习 Skill、安全保存凭据的 API 客户端、可恢复的练习流程和行为验证。
4. 统一复习：网页与 Codex 共用事件写入、离线事件队列、恢复焦点刷新、并发与重试验证。
5. 上线与验收：迁移、配置、部署和真实接口/页面检查，记录需要用户实际参与的实时语音验收。

每一阶段通过相关检查后单独 commit，再进入下一阶段。并行编写的文件按交付阶段分别提交。

## 交付记录

- `23ee0f8`：分阶段计划与接口契约。
- `38fc053`：鉴权 API、数据库及验证。
- `c6988f0`：网页连接、偏好和练习历史。
- `d18a543`：Codex Skill、客户端及安装器。
- `fb172c4`：统一事件、离线恢复、账号隔离与时区。
- `c74ac40`：v1.9.0 文档与部署配置。
- `fbfcac9`：根据生产运行验证修正 Node ESM 模块路径。

实际验收结果见 [验证记录](codex-verification.md)。

## 自动练习与训练中收藏

后续按三个阶段交付：先补齐按现有 SRS 选材、混合会话和新增单词 API；再简化网页设置、统一样式并更新 Codex Skill；最后完成安装、迁移、上线与隔离账号验收。默认练习为 10 项，英德语自动安排。记忆曲线决定单词优先级，句子抽取和题型、语境提供变化，不进行脱离排期的完全随机选词。

## API 契约

前缀 `/api/v1`。请求头 `Authorization: Bearer <token>`，支持网站的 Supabase access token 和 `vt_` 开头的个人访问令牌。个人令牌仅保存 SHA-256 摘要，可过期、撤销；权限为 `vocabulary:read`、`vocabulary:write`、`practice:write`、`sentences:write`。令牌管理只接受网站登录。所有请求的用户来自验证后的身份，绝不接受客户端指定 user_id。

JSON 成功返回 `{ data, meta? }`；错误返回 `{ error: { code, message } }`。列表采用 `limit`（1–100，默认 20）和 `offset`（默认 0）；meta 为 `{ has_more, next_offset }`。API 数据字段统一沿用数据库 snake_case；CLI 不另外复制学习数据。

| 方法/路径 | 参数/数据 | 结果 |
|---|---|---|
| GET /me | — | id、email（仅登录会话）、scopes、preferences |
| GET /words | language=en/de, q, category, ids=逗号分隔 UUID, limit, offset | 词汇 |
| POST /words | id(UUID), word, meaning, language=en/de, example?, example_cn?, category?, date?, etymology? | 词汇，meta 附 created/duplicate/replayed；日期默认当前学习时区的今天 |
| GET /practice-materials | limit=10, language=en/de?, timezone? | `{kind:'word',word,state}` / `{kind:'sentence',sentence}`；meta 附 available/count/selection/timezone |
| GET /sentences | language, q, limit, offset | 收藏句 |
| POST /sentences | id(UUID，重试保持一致), sentence, sentence_cn, language, scene, source_words | 保存收藏句 |
| GET /review | language, mode=due/ahead/all, timezone, limit, offset | `{word, state}` 列表，meta 附 counts |
| GET /tokens | — | 令牌元数据列表（无摘要或明文） |
| POST /tokens | name, scopes, expires_in_days=1..365 | `{token, access_token}`，明文仅此一次 |
| PATCH /tokens/:id | scopes | 令牌元数据；不恢复已撤销或过期连接 |
| DELETE /tokens/:id | — | 撤销结果 |
| GET /preferences | — | language, timezone, session_size, duration_minutes, correction_style, interests |
| PATCH /preferences | 上述字段的子集 | 更新后的偏好 |
| GET /sessions | status?, limit, offset | 练习会话列表 |
| POST /sessions | id(UUID), language=en/de/mixed, mode=conversation/recall/cloze, topic, word_ids(UUID[])?, sentence_ids(UUID[])?, target_minutes | 会话；两类目标总计 1–100 项 |
| GET /sessions/:id | — | `{session, events}` |
| PATCH /sessions/:id | status=active/completed/abandoned, summary, expected_version | 会话，版本冲突 409 |
| GET /events | word_id?, session_id?, limit, offset | 逐词作答历史 |
| POST /events | id(UUID), word_id, session_id?, grade=forgot/fuzzy/known, source=web/codex, practiced_at(ISO), timezone, answer?, feedback?, error_tags?, hint_count? | `{event, state, replayed}` |

只读令牌可以读取偏好和练习历史。`practice:write` 可写会话、事件和偏好，`vocabulary:write` 可添加单词，`sentences:write` 可保存句子。新权限不会自动赋予旧令牌。未练习/仅展示的词不提交事件；语音听不清不记作遗忘。练习开始的授权覆盖该次练习的合理记录，Skill 不逐词额外索要确认。

## 数据写入约束

- 服务端从当前权威状态计算 SRS；事件唯一 ID 防止网络重试重复计分。
- 逐词写入串行化；迟到的离线事件保留历史但不能使排期时间倒退。
- 原子地保存事件与更新状态。相同 ID 不同内容返回冲突。
- 会话、词和事件必须属于同一个用户；已完成会话不接收新作答。
- 现有 SRS 规则保持不变，并用共用测试案例验证数据库实现与前端预览一致。
- 网页离线保存事件而非覆盖整个云端状态；兼容并明确处理旧缓存。
- 生词本 API 只读取已同步的云端词汇。

## 完成标准

类型检查、服务/数据库/客户端测试与生产构建通过；验证鉴权、跨账号隔离、只读权限、令牌撤销、时区、分页、重复请求、会话恢复、离线并发和网页刷新；浏览器验证设置及练习历史；Skill 可安装并通过真实 API 取词。真实麦克风对话由用户参与验收，不能以文本模拟冒充。
