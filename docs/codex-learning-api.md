# 用 Codex 练习生词

词汇、例句、偏好和长期练习记录保存在 Vocab Tracker。Codex 使用项目 API 组织回忆、填空、情境对话和实时语音练习。模型不会另建本地词库，也不会自行决定排期算法。

## 连接

1. 登录网站，打开「设置 → 连接 Codex」。创建带所需权限的连接令牌：基础读取、保存练习结果、收藏句子可以分别控制。令牌明文只显示一次，可随时撤销。
2. 在项目目录执行 `bun run codex:install`，把复习 Skill 安装到个人 Codex 技能目录。
3. 在本机终端运行：

   ```sh
   bun ~/.codex/skills/vocab-review/scripts/vocab.ts configure --url https://vocab-tracker-sigma.vercel.app
   ```

   在隐藏输入提示中粘贴令牌。不要把令牌写进命令参数、URL、聊天或 Git。
4. 在新的 Codex 任务中说：“用我的生词本陪我复习十分钟”。支持当前任务的客户端中可打开实时语音。语音入口和麦克风权限由 Codex 提供。

macOS 默认用系统钥匙串保存令牌（需要系统 Swift，安装 Xcode Command Line Tools 即可获得）。其他环境可明确选用 `--storage file`，凭据文件权限为 0600，目录为 0700。网址与凭据绑定；程序拒绝跟随重定向。`status` 可检查连接，`logout` 清除本机凭据；网站撤销令牌才会终止其他副本的访问。

只读令牌也可以开展练习，但不会保存学习进度。完整练习会保存目标词、实际作答、提示次数、纠错和短总结。仅展示过的词不计入复习；听不清时不判为遗忘。未来任务可以读取未结束的会话与过去的错误继续练习。

## API 与数据

前缀 `/api/v1`，使用 `Authorization: Bearer <令牌>`。网页登录 JWT 也可使用，令牌管理仅接受网页登录。查询支持分页，列表最大每页 100 条，结果为 `{data,meta}`。详见 [接口契约](codex-integration-plan.md)。

- `words`、`sentences`：词汇搜索、语言/类别/日期筛选、收藏句。
- `review`：到期、提前或全部复习；按学习偏好的时区计算，返回实际 `meta.timezone`。云端尚未同步的离线词不能被 API 读取。
- `preferences`：语言、时区、词数、时长、纠错时机和兴趣。
- `sessions`：创建、恢复、查看、完成练习会话。更新使用版本号防止覆盖。
- `events`：逐词作答历史。每条作答用唯一 UUID；相同请求重试只记一次，相同 ID 不同内容返回 409。
- `tokens`：分页查看连接、创建、撤销；明文只在创建时返回，数据库只保存 SHA-256 摘要。

所有权来自服务器验证的身份，不接受客户端指定用户。私有结果设置 `Cache-Control: private, no-store`。API 查询不返回数据库凭据、令牌摘要或内部幂等请求字段。

## 离线与恢复

网页复习先把作答事件写入当前账号的 IndexedDB 队列，再推进卡片。联网后按顺序提交；网络超时仍使用原事件 ID。数据库对同一个词串行处理，原子地保存作答和新排期。迟于云端最新作答的离线历史仍被保留，但不会将排期时间倒退。

Codex 客户端也会在发送前保存最小待写入请求，命令 `pending` / `retry <id>` 用于恢复。会话或网络失败不应被描述为保存成功。该本地目录仅保留连接、未确认的作答与会话句柄，不复制词库。

旧版网页缓存缺少账号归属和逐次评级，不能可靠转成新事件。因此保留为只读本地备份，不上传覆盖云端。存在旧待同步数据时，复习页提供导出与明确清理选项。新版词汇和收藏句的原有离线编辑不受此迁移影响。

## 开发与部署

开发使用 Bun；Supabase CLI 通过 Homebrew 安装：

```sh
brew install supabase/tap/supabase
```

网站开发服务：`bun run dev`；另一个终端启动 API：`bun run dev:api`。Vite 将 `/api/v1` 转发到回环地址 3001。后端读取 `SUPABASE_URL`（或已有的 `VITE_SUPABASE_URL`）和 `SUPABASE_SERVICE_ROLE_KEY`。服务角色密钥只能放服务端环境变量，禁止加 `VITE_` 前缀。

升级顺序：

1. 应用 `supabase/migrations/20260923162938_codex_learning_api.sql`，增加学习 API 数据结构。它兼容尚未升级的网页。
2. 配置 Vercel Production 的服务端密钥，部署包含新网页与 API 的版本，验证新接口能读写。
3. 应用 `supabase/migrations/20260923164150_review_events_only.sql`，停止旧客户端直接覆盖/删除复习状态；新版通过事件 API 写入。已缓存旧版网页的设备需要刷新。

新项目直接执行最终 `schema.sql`。回滚到旧版网页前，必须评估其直接写复习状态的权限要求，不能静默撤掉事件保护。

检查命令：

```sh
bun run typecheck
bun run test:all
bun run build
VOCAB_TEST_KEYCHAIN=1 bun test tests/codex/keychain.test.ts
bun run verify:api --base-url=https://your-deployment
```

最后一个命令需要服务端凭据，会创建隔离临时账号与词汇，验证真实 API 后清理；`--keep-fixture` 仅用于浏览器验收，文件写在忽略且限权的 `artifacts/`，随后执行 `bun scripts/cleanup-learning-fixture.ts` 清理临时账号。真实语音的听说、打断及延迟需由用户实际参与验收，文本与接口测试不能替代。
