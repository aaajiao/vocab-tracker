# Supabase Setup Guide (Supabase 数据库设置指南)

[English](#english) | [中文](#chinese)

---

<a name="english"></a>
## 🇬🇧 English

This guide explains how to set up the database tables required for the Vocab Tracker application in Supabase.

> **Quick path**: Run [`schema.sql`](./schema.sql) in the SQL Editor — it creates all tables, indexes, grants, and RLS policies in one shot. The step-by-step blocks below are equivalent and exist for explanation. Past schema changes live in [`migrations/`](./migrations/).

### Prerequisites

1. Registered [Supabase](https://supabase.com) account.
2. Created a new project.

### Step 1: Get Project Credentials

1. Go to your Supabase Project Dashboard.
2. Navigate to **Settings** → **API**.
3. Copy the following info into your `.env` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Step 2: Create Database Tables

In the Supabase Dashboard, go to **SQL Editor** → **New Query**, and execute the following SQL:

#### 2.1 Create `words` table

```sql
-- Create words table
CREATE TABLE public.words (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    word        text NOT NULL,
    meaning     text NOT NULL,
    language    text NOT NULL CHECK (language = ANY (ARRAY['en'::text, 'de'::text])),
    example     text,
    example_cn  text,
    category    text CHECK (category = ANY (ARRAY['daily'::text, 'professional'::text, 'formal'::text, ''::text])),
    date        date NOT NULL DEFAULT CURRENT_DATE,
    created_at  timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    etymology   text,
    CONSTRAINT words_pkey PRIMARY KEY (id),
    CONSTRAINT words_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Create Indexes
CREATE INDEX idx_words_user_id ON words(user_id);
CREATE INDEX idx_words_language ON words(language);
CREATE INDEX idx_words_date ON words(date);

-- Grant Data API access
-- Required since 2026-05-30 for new projects, enforced for all projects 2026-10-30.
-- `anon` is intentionally NOT granted — this app requires login for all data access.
GRANT SELECT, INSERT, UPDATE, DELETE ON words TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON words TO service_role;

-- Enable RLS
ALTER TABLE words ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own words" 
    ON words FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own words" 
    ON words FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own words" 
    ON words FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own words" 
    ON words FOR DELETE 
    USING (auth.uid() = user_id);
```

#### 2.2 Create `saved_sentences` table

```sql
-- Create saved_sentences table
CREATE TABLE public.saved_sentences (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL,
    sentence      text NOT NULL,
    sentence_cn   text,
    language      character varying NOT NULL CHECK (language::text = ANY (ARRAY['en'::character varying, 'de'::character varying]::text[])),
    scene         character varying,
    source_type   character varying NOT NULL CHECK (source_type::text = ANY (ARRAY['combined'::character varying, 'word'::character varying]::text[])),
    source_words  jsonb DEFAULT '[]'::jsonb,
    created_at    timestamp with time zone DEFAULT now(),
    CONSTRAINT saved_sentences_pkey PRIMARY KEY (id),
    CONSTRAINT saved_sentences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_saved_sentences_user_id ON saved_sentences(user_id);
CREATE INDEX idx_saved_sentences_language ON saved_sentences(language);

-- Grant Data API access
-- Required since 2026-05-30 for new projects, enforced for all projects 2026-10-30.
-- `anon` is intentionally NOT granted — this app requires login for all data access.
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_sentences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_sentences TO service_role;

-- Enable RLS
ALTER TABLE saved_sentences ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own saved sentences" 
    ON saved_sentences FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved sentences" 
    ON saved_sentences FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved sentences" 
    ON saved_sentences FOR DELETE 
    USING (auth.uid() = user_id);
```

### Step 3: Configure Authentication

#### 3.1 Enable Email Auth
1. Go to **Authentication** → **Providers**.
2. Ensure **Email** is enabled.

#### 3.2 Configure Redirect URLs
1. Go to **Authentication** → **URL Configuration**.
2. **Site URL**: Set to your production domain (e.g., `https://your-domain.com`).
3. **Redirect URLs**: Add:
   - `http://localhost:5173/**` (Development)
   - `https://your-domain.com/**` (Production)

### Step 4: Verification
In the **Table Editor**, confirm that `words` and `saved_sentences` tables exist and have RLS enabled (look for the "RLS policies" badge).

---

<a name="chinese"></a>
## 🇨🇳 中文

本文档说明如何在 Supabase 中创建词汇本应用所需的数据库表。

> **快速建库**：直接在 SQL Editor 执行 [`schema.sql`](./schema.sql)，一次完成所有表、索引、授权和 RLS 策略。下面的分步骤 SQL 块和它等价，仅用于说明结构。历史 schema 变更见 [`migrations/`](./migrations/)。

### 前提条件

1. 已注册 [Supabase](https://supabase.com) 账号
2. 已创建一个新项目

### 步骤一：获取项目凭证

1. 进入 Supabase 项目 Dashboard
2. 点击左侧 **Settings** → **API**
3. 复制以下信息到 `.env` 文件：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 步骤二：创建数据库表

In Supabase Dashboard 左侧点击 **SQL Editor** → **New Query**，依次执行以下 SQL：

#### 2.1 创建 `words` 表（词汇存储）

```sql
-- 创建单词表
CREATE TABLE public.words (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    word        text NOT NULL,
    meaning     text NOT NULL,
    language    text NOT NULL CHECK (language = ANY (ARRAY['en'::text, 'de'::text])),
    example     text,
    example_cn  text,
    category    text CHECK (category = ANY (ARRAY['daily'::text, 'professional'::text, 'formal'::text, ''::text])),
    date        date NOT NULL DEFAULT CURRENT_DATE,
    created_at  timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    etymology   text,
    CONSTRAINT words_pkey PRIMARY KEY (id),
    CONSTRAINT words_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- 创建索引
CREATE INDEX idx_words_user_id ON words(user_id);
CREATE INDEX idx_words_language ON words(language);
CREATE INDEX idx_words_date ON words(date);

-- 显式授权 Data API
-- 2026-05-30 起新项目必须显式 GRANT，2026-10-30 对所有现有项目强制执行。
-- 故意不向 `anon` 授权 —— 本应用所有数据均需登录访问。
GRANT SELECT, INSERT, UPDATE, DELETE ON words TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON words TO service_role;

-- 启用行级安全策略 (RLS)
ALTER TABLE words ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的单词
CREATE POLICY "Users can view own words" 
    ON words FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own words" 
    ON words FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own words" 
    ON words FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own words" 
    ON words FOR DELETE 
    USING (auth.uid() = user_id);
```

#### 2.2 创建 `saved_sentences` 表（收藏句子）

```sql
-- 创建收藏句子表
CREATE TABLE public.saved_sentences (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL,
    sentence      text NOT NULL,
    sentence_cn   text,
    language      character varying NOT NULL CHECK (language::text = ANY (ARRAY['en'::character varying, 'de'::character varying]::text[])),
    scene         character varying,
    source_type   character varying NOT NULL CHECK (source_type::text = ANY (ARRAY['combined'::character varying, 'word'::character varying]::text[])),
    source_words  jsonb DEFAULT '[]'::jsonb,
    created_at    timestamp with time zone DEFAULT now(),
    CONSTRAINT saved_sentences_pkey PRIMARY KEY (id),
    CONSTRAINT saved_sentences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- 创建索引
CREATE INDEX idx_saved_sentences_user_id ON saved_sentences(user_id);
CREATE INDEX idx_saved_sentences_language ON saved_sentences(language);

-- 显式授权 Data API
-- 2026-05-30 起新项目必须显式 GRANT，2026-10-30 对所有现有项目强制执行。
-- 故意不向 `anon` 授权 —— 本应用所有数据均需登录访问。
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_sentences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_sentences TO service_role;

-- 启用行级安全策略 (RLS)
ALTER TABLE saved_sentences ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的收藏
CREATE POLICY "Users can view own saved sentences" 
    ON saved_sentences FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved sentences" 
    ON saved_sentences FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved sentences" 
    ON saved_sentences FOR DELETE 
    USING (auth.uid() = user_id);
```

### 步骤三：配置认证

#### 3.1 启用邮箱认证

1. 进入 **Authentication** → **Providers**
2. 确保 **Email** 已启用

#### 3.2 配置重定向 URL

1. 进入 **Authentication** → **URL Configuration**
2. **Site URL**: 设置为生产环境域名（如 `https://your-domain.com`）
3. **Redirect URLs**: 添加重定向规则：
   - `http://localhost:5173/**`（开发环境）
   - `https://your-domain.com/**`（生产环境）

### 步骤四：验证设置

在 **Table Editor** 中确认以下表已创建：
- ✅ `words`
- ✅ `saved_sentences`

确认右上角显示 RLS 策略按钮，表明安全设置已生效。
