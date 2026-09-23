# Supabase Setup Guide (Supabase 数据库设置指南)

[English](#english) | [中文](#chinese)

---

<a name="english"></a>
## 🇬🇧 English

Use [`schema.sql`](./schema.sql) as the single source of truth for a **new database**. It creates the vocabulary tables and Codex learning tables, indexes, explicit grants, and RLS. Existing deployments must follow the [two-phase learning API upgrade](./docs/codex-learning-api.md#开发与部署).

For an **existing database**, use the applicable scripts in [`migrations/`](./migrations/README.md). `CREATE TABLE IF NOT EXISTS` does not update existing columns or constraints, so rerunning `schema.sql` is not a substitute for an upgrade migration.

### Prerequisites

1. A [Supabase](https://supabase.com) account.
2. A new Supabase project.

### Step 1: Get Project Credentials

Copy the project's URL and client API key from the Supabase dashboard into your `.env` file. The variable name below is retained for compatibility; use a publishable key or the legacy `anon` key, never a secret or `service_role` key in this browser app.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

### Step 2: Create Database Tables

1. Open **SQL Editor** → **New Query** in the Supabase dashboard.
2. Copy the complete contents of [`schema.sql`](./schema.sql) into the editor and run it.
3. Confirm that the query completes successfully. The file creates the following tables in order:

| Table | Contents and relationships |
|---|---|
| `words` | Vocabulary, translations, language, examples, category, date, and etymology. UUID primary key `id`; `user_id` references `auth.users(id)`. |
| `saved_sentences` | Saved or directly entered sentences. `source_type` supports `word`, `combined`, and `input`; JSONB arrays `source_words`, `keywords`, and `grammar` hold source words, key vocabulary, and grammar notes. UUID primary key `id`; `user_id` references `auth.users(id)`. |
| `review_states` | SRS progress: `due`, `interval_days`, `ease`, `reps`, `lapses`, `last_reviewed_at`, and `updated_at`. Primary key `word_id` references `words(id)` with `ON DELETE CASCADE`; `user_id` references `auth.users(id)`. An index on `(user_id, due)` supports due reviews. |

#### Data API permissions and RLS

All tables enable RLS and revoke `anon` access. `words` and `saved_sentences` retain authenticated CRUD grants with owner policies. `review_states` grants authenticated SELECT only. `api_access_tokens`, `learning_preferences`, `practice_sessions`, and `review_events` are available only through the authenticated learning API, whose service-side role verifies the owner. `service_role` bypasses RLS and must never be exposed to a browser or Codex client.

Grants allow access to a table; policies limit rows and operations. `saved_sentences` has reading, inserting and deleting policies; `words` also has an update policy. Review mutations go through the event API. A table grant alone does not bypass RLS.

Supabase began rolling out explicit opt-in for newly created tables in new projects on **2026-05-30**. On **2026-10-30**, existing projects also stop automatically granting Data API access to tables created afterward in `public`. **Existing tables retain their current grants.** Our schema already includes explicit grants, so it does not depend on automatic table grants. See the [official announcement](https://github.com/orgs/supabase/discussions/45329).

For every future table exposed through the Data API, include explicit grants, RLS, and the required policies in the same migration. The current schema uses UUID keys and has no sequences needing separate grants.

### Step 3: Configure Authentication

#### 3.1 Enable Email Auth

1. Open the email sign-in provider settings under **Authentication**.
2. Ensure **Email** is enabled.

#### 3.2 Configure Redirect URLs

1. Go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to your production domain, for example `https://your-domain.com`.
3. Add the following **Redirect URLs**:
   - `http://localhost:5173/**` (development)
   - `https://your-domain.com/**` (production)

### Step 4: Verify the Setup

1. Confirm that `words`, `saved_sentences`, and `review_states` exist in **Table Editor** and have RLS enabled.
2. Run the [permission check below](#permission-check). The three original tables produce nine rows: `anon` has no access; `service_role` has CRUD; `authenticated` has CRUD on words/sentences and SELECT only on review_states. Also confirm the four learning tables enable RLS and are service-role-only.
3. Sign in to the app, add a word, save a directly entered sentence, and complete a review. Reload the app and confirm the records remain. Check that the review state appears on another signed-in device; local caching can otherwise conceal a missing `review_states` table.

---

<a name="chinese"></a>
## 🇨🇳 中文

**新建数据库**统一使用 [`schema.sql`](./schema.sql)。它会创建词汇和 Codex 学习表、索引、显式授权与 RLS。已有数据库按[学习 API 升级顺序](./docs/codex-learning-api.md#开发与部署)分阶段迁移。

**已有数据库**请按需执行 [`migrations/`](./migrations/README.md) 中的升级脚本。`CREATE TABLE IF NOT EXISTS` 不会更新现有列或约束，因此重新运行 `schema.sql` 不能代替升级迁移。

### 前提条件

1. 已注册 [Supabase](https://supabase.com) 账号。
2. 已创建一个新的 Supabase 项目。

### 步骤一：获取项目凭证

从 Supabase 控制台复制项目 URL 和客户端 API key，填入 `.env` 文件。以下变量名为兼容现有代码而保留；可以使用 publishable key 或旧版 `anon` key，浏览器应用中不能使用 secret key 或 `service_role` key。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

### 步骤二：创建数据库表

1. 在 Supabase 控制台打开 **SQL Editor** → **New Query**。
2. 将 [`schema.sql`](./schema.sql) 的完整内容复制到编辑器并执行。
3. 确认执行成功。原有三张业务表如下，另有四张学习 API 表：`api_access_tokens`、`learning_preferences`、`practice_sessions`、`review_events`。

| 表 | 内容与关联 |
|---|---|
| `words` | 词汇、释义、语言、例句、分类、日期和词源。UUID 主键 `id`；`user_id` 关联 `auth.users(id)`。 |
| `saved_sentences` | 收藏或直接输入的句子。`source_type` 支持 `word`、`combined`、`input`；JSONB 数组 `source_words`、`keywords`、`grammar` 分别保存来源词、重点词和语法说明。UUID 主键 `id`；`user_id` 关联 `auth.users(id)`。 |
| `review_states` | SRS 复习进度：`due`、`interval_days`、`ease`、`reps`、`lapses`、`last_reviewed_at`、`updated_at`。主键 `word_id` 关联 `words(id)`，删词时通过 `ON DELETE CASCADE` 自动删除对应复习状态；`user_id` 关联 `auth.users(id)`。`(user_id, due)` 索引用于查询到期复习。 |

#### Data API 权限与 RLS

所有表均启用 RLS 并撤销 `anon` 权限。词汇和收藏句保留登录用户的 CRUD 授权及本人数据策略；复习状态仅允许登录用户读取，通过事件 API 更新。四张学习 API 表仅授权服务端 `service_role`，由 API 验证账号归属。服务角色密钥禁止放入网页、Codex 令牌或任何 `VITE_` 环境变量。

授权决定能否访问表，策略决定可访问的行与操作。收藏句配置读、增、删策略；词汇还有更新策略；复习状态通过事件 API 修改。获得表权限不代表可以绕过 RLS。

Supabase 从 **2026-05-30** 开始逐步对新项目采用新建表需显式授权的规则；从 **2026-10-30** 起，现有项目也不再为之后在 `public` 中创建的表自动授予 Data API 权限。**已有表保留当前授权。** 本项目的建表脚本已包含显式授权，不依赖自动表授权。详情见[官方公告](https://github.com/orgs/supabase/discussions/45329)。

以后新增需要通过 Data API 访问的表时，应在同一迁移中配置显式授权、RLS 和所需策略。当前结构使用 UUID 键，没有需要单独授权的序列。

### 步骤三：配置认证

#### 3.1 启用邮箱认证

1. 在 **Authentication** 下打开邮箱登录提供方设置。
2. 确保 **Email** 已启用。

#### 3.2 配置重定向 URL

1. 进入 **Authentication** → **URL Configuration**。
2. 将 **Site URL** 设置为生产环境域名，例如 `https://your-domain.com`。
3. 添加以下 **Redirect URLs**：
   - `http://localhost:5173/**`（开发环境）
   - `https://your-domain.com/**`（生产环境）

### 步骤四：验证设置

1. 在 **Table Editor** 中确认 `words`、`saved_sentences`、`review_states` 均已创建，并已启用 RLS。
2. 运行下方[权限检查](#permission-check)。原有三张表返回9行：anon无权限；service_role有CRUD；authenticated对词汇/句子有CRUD授权，对review_states仅有SELECT。另外确认四张学习表开启RLS、仅授权service_role。
3. 登录应用，添加单词、保存直接输入的句子，并完成一次复习。刷新后确认记录仍在，再用另一台已登录设备确认复习状态同步。仅检查本地缓存可能掩盖缺少 `review_states` 表的问题。

---

<a name="permission-check"></a>
## Permission Check / 权限检查

Read-only; does not change permissions or read application records. 只读查询，不修改权限或读取业务记录。

```sql
SELECT
    c.relname AS table_name,
    r.rolname AS role_name,
    c.relrowsecurity AS rls_enabled,
    has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usage,
    has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
    has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
    has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
    has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname IN ('words', 'saved_sentences', 'review_states')
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY c.relname, r.rolname;
```
