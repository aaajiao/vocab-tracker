# Supabase Setup Guide (Supabase 数据库设置指南)

[English](#english) | [中文](#chinese)

---

<a name="english"></a>
## 🇬🇧 English

Use [`schema.sql`](./schema.sql) as the single source of truth for a **new database**. It creates all three tables, indexes, explicit Data API grants, and Row Level Security (RLS) policies. This guide explains that setup without maintaining a second copy of the table definitions.

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

For all three tables, `schema.sql` explicitly grants `SELECT`, `INSERT`, `UPDATE`, and `DELETE` to `authenticated` and `service_role`, revokes all table privileges from `anon`, and enables RLS. Revoking `anon` also removes any grants inherited from older project defaults. Signed-in users are restricted to their own rows by `auth.uid() = user_id`; `service_role` is reserved for trusted server-side use and bypasses RLS.

Grants and RLS have different purposes: grants allow a role to access a table; policies decide which rows and operations are allowed. `saved_sentences` has policies for reading, inserting, and deleting; `words` and `review_states` also have an update policy. A table grant alone does not permit an operation that RLS disallows.

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
2. Run the read-only [permission check below](#permission-check) in SQL Editor. Expect **nine rows**: three roles for each of the three tables. `rls_enabled` and `schema_usage` should be `true` throughout; all four operation flags should be `true` for `authenticated` and `service_role`, and `false` for `anon`.
3. Sign in to the app, add a word, save a directly entered sentence, and complete a review. Reload the app and confirm the records remain. Check that the review state appears on another signed-in device; local caching can otherwise conceal a missing `review_states` table.

---

<a name="chinese"></a>
## 🇨🇳 中文

**新建数据库**统一使用 [`schema.sql`](./schema.sql)。它会创建全部三张表、索引、显式 Data API 授权和行级安全（RLS）策略。本指南解释设置步骤，表结构以该文件为准，避免维护多份建表 SQL。

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
3. 确认执行成功。文件会依次创建以下三张表：

| 表 | 内容与关联 |
|---|---|
| `words` | 词汇、释义、语言、例句、分类、日期和词源。UUID 主键 `id`；`user_id` 关联 `auth.users(id)`。 |
| `saved_sentences` | 收藏或直接输入的句子。`source_type` 支持 `word`、`combined`、`input`；JSONB 数组 `source_words`、`keywords`、`grammar` 分别保存来源词、重点词和语法说明。UUID 主键 `id`；`user_id` 关联 `auth.users(id)`。 |
| `review_states` | SRS 复习进度：`due`、`interval_days`、`ease`、`reps`、`lapses`、`last_reviewed_at`、`updated_at`。主键 `word_id` 关联 `words(id)`，删词时通过 `ON DELETE CASCADE` 自动删除对应复习状态；`user_id` 关联 `auth.users(id)`。`(user_id, due)` 索引用于查询到期复习。 |

#### Data API 权限与 RLS

`schema.sql` 会为三张表显式授予 `authenticated` 和 `service_role` 角色 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 权限，撤销 `anon` 的全部表权限，并启用 RLS。显式撤销 `anon` 也会收回旧项目默认设置曾授予的权限。登录用户受 `auth.uid() = user_id` 策略限制，只能访问自己的行；`service_role` 仅供可信服务端使用，会绕过 RLS。

授权和 RLS 分工不同：授权决定角色能否访问表，策略决定可以访问哪些行、执行哪些操作。`saved_sentences` 配置了读取、插入、删除策略；`words` 和 `review_states` 还配置了更新策略。获得表权限不代表可以绕过 RLS 执行操作。

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
2. 在 SQL Editor 运行下方只读的[权限检查](#permission-check)。预期返回 **9 行**，即每张表对应三个角色。所有行的 `rls_enabled` 和 `schema_usage` 应为 `true`；`authenticated` 和 `service_role` 的四项操作权限应全为 `true`，`anon` 应全为 `false`。
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
