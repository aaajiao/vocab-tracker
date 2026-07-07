-- ============================================================
-- Vocab Tracker - Canonical Database Schema
-- ============================================================
-- 这是数据库当前生产状态的"单一事实来源"，严格按 Supabase 实际 schema 编写。
-- 在全新的 Supabase 项目上完整执行本文件即可建好所有表、索引、
-- 权限和 RLS 策略。
--
-- 老项目升级历史见 migrations/ 目录。
--
-- 使用方法：Supabase Dashboard → SQL Editor → New Query → 全选粘贴 → Run
-- ============================================================


-- ============================================================
-- 1. words 表 —— 用户的词汇记录
-- ============================================================

CREATE TABLE IF NOT EXISTS public.words (
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

-- 索引
CREATE INDEX IF NOT EXISTS idx_words_user_id  ON public.words(user_id);
CREATE INDEX IF NOT EXISTS idx_words_language ON public.words(language);
CREATE INDEX IF NOT EXISTS idx_words_date     ON public.words(date);

-- Data API 授权
-- 2026-05-30 起新项目必须显式 GRANT，2026-10-30 对所有现有项目强制执行。
-- `anon` 无任何权限 —— 本应用所有数据均需登录访问。
-- 注意：Supabase 对 public schema 有默认授权，CREATE TABLE 时会自动把全部权限
-- 授给 anon，必须显式 REVOKE 收掉，只写「不 GRANT」是不够的。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.words TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.words TO service_role;
REVOKE ALL ON public.words FROM anon;

-- 行级安全
ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own words"   ON public.words;
DROP POLICY IF EXISTS "Users can insert own words" ON public.words;
DROP POLICY IF EXISTS "Users can update own words" ON public.words;
DROP POLICY IF EXISTS "Users can delete own words" ON public.words;

CREATE POLICY "Users can view own words"
    ON public.words FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own words"
    ON public.words FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own words"
    ON public.words FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own words"
    ON public.words FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
-- 2. saved_sentences 表 —— 用户收藏的例句
-- ============================================================

CREATE TABLE IF NOT EXISTS public.saved_sentences (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL,
    sentence      text NOT NULL,
    sentence_cn   text,
    language      character varying NOT NULL CHECK (language::text = ANY (ARRAY['en'::character varying, 'de'::character varying]::text[])),
    scene         character varying,
    source_type   character varying NOT NULL CHECK (source_type::text = ANY (ARRAY['combined'::character varying, 'word'::character varying, 'input'::character varying]::text[])),
    source_words  jsonb DEFAULT '[]'::jsonb,
    keywords      jsonb DEFAULT '[]'::jsonb,
    grammar       jsonb DEFAULT '[]'::jsonb,
    created_at    timestamp with time zone DEFAULT now(),
    CONSTRAINT saved_sentences_pkey PRIMARY KEY (id),
    CONSTRAINT saved_sentences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_saved_sentences_user_id  ON public.saved_sentences(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_sentences_language ON public.saved_sentences(language);

-- Data API 授权（同上策略，含收掉 anon 默认授权）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_sentences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_sentences TO service_role;
REVOKE ALL ON public.saved_sentences FROM anon;

-- 行级安全
ALTER TABLE public.saved_sentences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own saved sentences"   ON public.saved_sentences;
DROP POLICY IF EXISTS "Users can insert own saved sentences" ON public.saved_sentences;
DROP POLICY IF EXISTS "Users can delete own saved sentences" ON public.saved_sentences;

CREATE POLICY "Users can view own saved sentences"
    ON public.saved_sentences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved sentences"
    ON public.saved_sentences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved sentences"
    ON public.saved_sentences FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
-- 3. review_states 表 —— 单词的间隔重复（SRS）复习状态
-- ============================================================

CREATE TABLE IF NOT EXISTS public.review_states (
    word_id          uuid NOT NULL,
    user_id          uuid NOT NULL,
    due              date NOT NULL,
    interval_days    integer NOT NULL DEFAULT 0,
    ease             real NOT NULL DEFAULT 2.5,
    reps             integer NOT NULL DEFAULT 0,
    lapses           integer NOT NULL DEFAULT 0,
    last_reviewed_at timestamp with time zone,
    updated_at       timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT review_states_pkey PRIMARY KEY (word_id),
    -- 删词自动清理其复习状态（有意为之：复习状态离不开对应的词）
    CONSTRAINT review_states_word_id_fkey FOREIGN KEY (word_id)
        REFERENCES public.words(id) ON DELETE CASCADE,
    CONSTRAINT review_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- 索引：按用户 + 到期日查询「今日到期」
CREATE INDEX IF NOT EXISTS idx_review_states_user_due ON public.review_states(user_id, due);

-- Data API 授权（同 words 表策略，含收掉 anon 默认授权）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO service_role;
REVOKE ALL ON public.review_states FROM anon;

-- 行级安全
ALTER TABLE public.review_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own review states"   ON public.review_states;
DROP POLICY IF EXISTS "Users can insert own review states" ON public.review_states;
DROP POLICY IF EXISTS "Users can update own review states" ON public.review_states;
DROP POLICY IF EXISTS "Users can delete own review states" ON public.review_states;

CREATE POLICY "Users can view own review states"
    ON public.review_states FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own review states"
    ON public.review_states FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own review states"
    ON public.review_states FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own review states"
    ON public.review_states FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
-- 验证（可选）：查看授权情况
-- ============================================================
-- 期望结果：authenticated / service_role / postgres 各 1 行，无 anon
--
-- SELECT
--     table_name, grantee,
--     string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('words', 'saved_sentences', 'review_states')
--   AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
-- GROUP BY table_name, grantee
-- ORDER BY table_name, grantee;
