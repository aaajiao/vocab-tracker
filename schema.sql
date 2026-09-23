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
-- Supabase 从 2026-05-30 起逐步为新项目停用 public 新建表的默认授权；
-- 2026-10-30 起现有项目也停止对之后新建的表自动授权，已有表权限保留。
-- 本文件显式 GRANT，因此建表不依赖项目的默认授权设置。
-- `anon` 无任何权限 —— 本应用所有数据均需登录访问。
-- 若项目仍有旧的默认授权，CREATE TABLE 可能已给 anon 权限；
-- 显式 REVOKE 会收回这些权限，只写「不 GRANT」不会撤销已有授权。
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

-- Data API 授权（同上策略，收回 anon 可能已有的权限）
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

-- Data API 授权（同 words 表策略，收回 anon 可能已有的权限）
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
-- 期望结果：每张表的 authenticated / service_role / postgres 各 1 行，无 anon
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


-- ============================================================
-- 4. Codex 学习 API（与 supabase/migrations/20260923162938_codex_learning_api.sql 同步）
-- ============================================================

-- 学习 API 的数据基础。只由已鉴权的服务端调用写入函数。
-- SECURITY INVOKER 保留调用者权限；客户端不能直接执行这些 RPC。

CREATE TABLE public.api_access_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    prefix text NOT NULL CHECK (char_length(prefix) BETWEEN 6 AND 24),
    scopes text[] NOT NULL CHECK (
        cardinality(scopes) BETWEEN 1 AND 3
        AND scopes <@ ARRAY['vocabulary:read', 'practice:write', 'sentences:write']::text[]
        AND array_position(scopes, NULL) IS NULL
    ),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days')
);
CREATE INDEX idx_api_access_tokens_user_created ON public.api_access_tokens(user_id, created_at DESC, id);

CREATE FUNCTION public.learning_valid_text_array(p_values text[], p_max_count integer, p_max_length integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT p_values IS NOT NULL AND cardinality(p_values) <= p_max_count
       AND NOT EXISTS (
           SELECT 1 FROM unnest(p_values) AS value
           WHERE value IS NULL OR char_length(btrim(value)) NOT BETWEEN 1 AND p_max_length
       );
$$;
CREATE FUNCTION public.learning_valid_timezone(p_timezone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT p_timezone IS NOT NULL AND char_length(p_timezone) <= 100
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone);
$$;

CREATE TABLE public.learning_preferences (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    language text NOT NULL DEFAULT 'de' CHECK (language IN ('en', 'de')),
    timezone text NOT NULL DEFAULT 'Europe/Berlin' CHECK (public.learning_valid_timezone(timezone)),
    session_size integer NOT NULL DEFAULT 10 CHECK (session_size BETWEEN 1 AND 50),
    duration_minutes integer NOT NULL DEFAULT 10 CHECK (duration_minutes BETWEEN 1 AND 60),
    correction_style text NOT NULL DEFAULT 'after_answer' CHECK (correction_style IN ('after_answer', 'end_of_session')),
    interests text[] NOT NULL DEFAULT '{}' CHECK (public.learning_valid_text_array(interests, 20, 80)),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.practice_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    language text NOT NULL CHECK (language IN ('en', 'de')),
    mode text NOT NULL CHECK (mode IN ('conversation', 'recall', 'cloze')),
    topic text NOT NULL DEFAULT '' CHECK (char_length(topic) <= 500),
    word_ids uuid[] NOT NULL CHECK (cardinality(word_ids) BETWEEN 1 AND 100 AND array_position(word_ids, NULL) IS NULL),
    target_minutes integer NOT NULL DEFAULT 10 CHECK (target_minutes BETWEEN 1 AND 60),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 12000),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    initial_payload jsonb NOT NULL CHECK (jsonb_typeof(initial_payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((status = 'active' AND completed_at IS NULL) OR (status <> 'active' AND completed_at IS NOT NULL))
);
CREATE INDEX idx_practice_sessions_user_created ON public.practice_sessions(user_id, created_at DESC, id);
CREATE INDEX idx_practice_sessions_user_status ON public.practice_sessions(user_id, status, created_at DESC);

CREATE TABLE public.review_events (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 保留原词 ID 和快照，删除词汇不会抹去已完成的学习历史。
    word_id uuid NOT NULL,
    session_id uuid REFERENCES public.practice_sessions(id) ON DELETE SET NULL,
    grade text NOT NULL CHECK (grade IN ('forgot', 'fuzzy', 'known')),
    source text NOT NULL CHECK (source IN ('web', 'codex')),
    practiced_at timestamptz NOT NULL CHECK (practiced_at >= timestamptz '2000-01-01 00:00:00+00'),
    timezone text NOT NULL CHECK (public.learning_valid_timezone(timezone)),
    answer text CHECK (char_length(answer) <= 8000),
    feedback text CHECK (char_length(feedback) <= 8000),
    error_tags text[] NOT NULL DEFAULT '{}' CHECK (public.learning_valid_text_array(error_tags, 20, 80)),
    hint_count integer NOT NULL DEFAULT 0 CHECK (hint_count BETWEEN 0 AND 100),
    scheduling_applied boolean NOT NULL,
    state_after jsonb NOT NULL CHECK (jsonb_typeof(state_after) = 'object'),
    word_snapshot jsonb NOT NULL CHECK (jsonb_typeof(word_snapshot) = 'object'),
    request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_events_user_practiced ON public.review_events(user_id, practiced_at DESC, id);
CREATE INDEX idx_review_events_word_practiced ON public.review_events(user_id, word_id, practiced_at DESC, id);
CREATE INDEX idx_review_events_session ON public.review_events(session_id, practiced_at, id);

-- 与前端 JavaScript 的双精度计算保持一致，避免 real 舍入改变 ceil 的结果。
ALTER TABLE public.review_states ALTER COLUMN ease TYPE double precision USING ease::text::double precision;

-- 元数据与学习记录仅经项目 API 提供。显式撤销可能由旧默认权限继承的授权。
ALTER TABLE public.api_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_access_tokens, public.learning_preferences, public.practice_sessions, public.review_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_access_tokens, public.learning_preferences, public.practice_sessions, public.review_events TO service_role;

CREATE FUNCTION public.learning_get_review(
    p_user_id uuid,
    p_language text DEFAULT NULL,
    p_mode text DEFAULT 'due',
    p_timezone text DEFAULT 'Europe/Berlin',
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_today date;
    v_result jsonb;
BEGIN
    IF p_user_id IS NULL OR (p_language IS NOT NULL AND p_language NOT IN ('en', 'de'))
       OR p_mode IS NULL OR p_mode NOT IN ('due', 'ahead', 'all')
       OR NOT public.learning_valid_timezone(p_timezone)
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
       OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_review_query';
    END IF;
    v_today := (now() AT TIME ZONE p_timezone)::date;
    -- 同一用户的并行回填共享排序；现有排期永不被初始化覆盖。
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('review-init:' || p_user_id::text, 0));
    INSERT INTO public.review_states (word_id, user_id, due)
    SELECT missing.id, p_user_id, v_today + ((missing.position - 1) / 20)::integer
    FROM (
        SELECT w.id, row_number() OVER (ORDER BY w.created_at DESC, w.id) AS position
        FROM public.words w
        WHERE w.user_id = p_user_id
          AND NOT EXISTS (SELECT 1 FROM public.review_states s WHERE s.word_id = w.id)
    ) missing
    ON CONFLICT (word_id) DO NOTHING;

    WITH available AS (
        SELECT w.id, w.created_at, s.due,
            jsonb_build_object('word', to_jsonb(w), 'state', to_jsonb(s)) AS entry,
            s.last_reviewed_at
        FROM public.words w JOIN public.review_states s ON s.word_id = w.id AND s.user_id = w.user_id
        WHERE w.user_id = p_user_id AND (p_language IS NULL OR w.language = p_language)
    ), selected AS (
        SELECT * FROM available
        WHERE p_mode = 'all' OR (p_mode = 'due' AND due <= v_today) OR (p_mode = 'ahead' AND due > v_today)
        ORDER BY due, created_at DESC, id
        LIMIT p_limit OFFSET p_offset
    ), counts AS (
        SELECT count(*) AS total_tracked,
            count(*) FILTER (WHERE due <= v_today) AS due,
            count(*) FILTER (WHERE due > v_today) AS ahead,
            count(*) FILTER (WHERE due = v_today + 1) AS tomorrow,
            count(*) FILTER (WHERE (last_reviewed_at AT TIME ZONE p_timezone)::date = v_today) AS reviewed_today,
            count(*) FILTER (WHERE p_mode = 'all' OR (p_mode = 'due' AND due <= v_today) OR (p_mode = 'ahead' AND due > v_today)) AS selected_count
        FROM available
    )
    SELECT jsonb_build_object(
        'data', COALESCE((SELECT jsonb_agg(entry ORDER BY due, created_at DESC, id) FROM selected), '[]'::jsonb),
        'meta', jsonb_build_object(
            'has_more', c.selected_count > p_offset + p_limit,
            'next_offset', CASE WHEN c.selected_count > p_offset + p_limit THEN p_offset + p_limit ELSE NULL END,
            'counts', jsonb_build_object('due', c.due, 'total_tracked', c.total_tracked,
                'reviewed_today', c.reviewed_today, 'tomorrow', c.tomorrow, 'ahead', c.ahead)
        )
    ) INTO v_result FROM counts c;
    RETURN v_result;
END;
$$;

CREATE FUNCTION public.learning_create_session(p_user_id uuid, p_session jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_words uuid[];
    v_payload jsonb;
    v_session public.practice_sessions%ROWTYPE;
    v_word public.words%ROWTYPE;
    v_minutes integer;
BEGIN
    IF p_user_id IS NULL OR p_session IS NULL OR jsonb_typeof(p_session) <> 'object'
       OR NOT (p_session ?& ARRAY['id','language','mode','word_ids'])
       OR (p_session - ARRAY['id','language','mode','topic','word_ids','target_minutes']) <> '{}'::jsonb
       OR jsonb_typeof(p_session->'word_ids') <> 'array'
       OR (p_session ? 'topic' AND jsonb_typeof(p_session->'topic') <> 'string')
       OR (p_session ? 'target_minutes' AND jsonb_typeof(p_session->'target_minutes') <> 'number')
       OR (p_session->>'language') NOT IN ('en','de') OR (p_session->>'mode') NOT IN ('conversation','recall','cloze')
       OR char_length(COALESCE(p_session->>'topic','')) > 500 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session';
    END IF;
    BEGIN
        v_id := (p_session->>'id')::uuid;
        SELECT array_agg(value::uuid ORDER BY ordinal) INTO v_words
            FROM jsonb_array_elements_text(p_session->'word_ids') WITH ORDINALITY AS item(value, ordinal);
        v_minutes := COALESCE((p_session->>'target_minutes')::integer, 10);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session';
    END;
    IF v_id IS NULL OR v_words IS NULL OR cardinality(v_words) NOT BETWEEN 1 AND 100
       OR array_position(v_words, NULL) IS NOT NULL OR v_minutes NOT BETWEEN 1 AND 60
       OR cardinality(v_words) <> (SELECT count(DISTINCT word_id) FROM unnest(v_words) AS word_id)
       OR p_session->>'language' IS NULL OR p_session->>'mode' IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session';
    END IF;
    v_payload := jsonb_build_object('id', v_id, 'language', p_session->>'language', 'mode', p_session->>'mode',
        'topic', COALESCE(p_session->>'topic',''), 'word_ids', to_jsonb(v_words), 'target_minutes', v_minutes);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('session:' || v_id::text, 0));
    SELECT * INTO v_session FROM public.practice_sessions WHERE id = v_id;
    IF FOUND THEN
        IF v_session.user_id <> p_user_id OR v_session.initial_payload <> v_payload THEN
            RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'session_id_conflict';
        END IF;
        RETURN to_jsonb(v_session) - 'initial_payload';
    END IF;
    -- 固定次序锁住词汇，保证创建时归属与语言准确，并与并发删词协调。
    FOR v_word IN SELECT * FROM public.words WHERE id = ANY(v_words) ORDER BY id FOR KEY SHARE LOOP
        IF v_word.user_id <> p_user_id OR v_word.language <> p_session->>'language' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'word_not_found';
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.words WHERE id = ANY(v_words) AND user_id = p_user_id) <> cardinality(v_words) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'word_not_found';
    END IF;
    INSERT INTO public.practice_sessions (id,user_id,language,mode,topic,word_ids,target_minutes,initial_payload)
    VALUES (v_id,p_user_id,p_session->>'language',p_session->>'mode',COALESCE(p_session->>'topic',''),v_words,v_minutes,v_payload)
    RETURNING * INTO v_session;
    RETURN to_jsonb(v_session) - 'initial_payload';
END;
$$;

CREATE FUNCTION public.learning_update_session(p_user_id uuid, p_session_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_session public.practice_sessions%ROWTYPE;
    v_status text;
    v_summary text;
    v_expected integer;
BEGIN
    IF p_user_id IS NULL OR p_session_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
       OR NOT (p_patch ? 'expected_version') OR NOT (p_patch ?| ARRAY['status','summary'])
       OR (p_patch - ARRAY['status','summary','expected_version']) <> '{}'::jsonb
       OR (p_patch ? 'status' AND (p_patch->>'status' IS NULL OR p_patch->>'status' NOT IN ('active','completed','abandoned')))
       OR (p_patch ? 'summary' AND (p_patch->>'summary' IS NULL OR char_length(p_patch->>'summary') > 12000)) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session_patch';
    END IF;
    BEGIN
        IF jsonb_typeof(p_patch->'expected_version') <> 'number'
           OR (p_patch ? 'summary' AND jsonb_typeof(p_patch->'summary') <> 'string') THEN
            RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session_patch';
        END IF;
        v_expected := (p_patch->>'expected_version')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session_version';
    END;
    IF v_expected IS NULL OR v_expected < 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_session_version';
    END IF;
    SELECT * INTO v_session FROM public.practice_sessions WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'session_not_found'; END IF;
    IF v_session.version <> v_expected THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'session_version_conflict';
    END IF;
    v_status := COALESCE(p_patch->>'status',v_session.status);
    v_summary := COALESCE(p_patch->>'summary',v_session.summary);
    IF v_session.status <> 'active' AND v_status <> v_session.status THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'session_already_closed';
    END IF;
    UPDATE public.practice_sessions SET status = v_status, summary = v_summary, version = version + 1,
        updated_at = now(), completed_at = CASE WHEN v_status = 'active' THEN NULL ELSE COALESCE(completed_at,now()) END
    WHERE id = p_session_id RETURNING * INTO v_session;
    RETURN to_jsonb(v_session) - 'initial_payload';
END;
$$;

CREATE FUNCTION public.learning_record_event(p_user_id uuid, p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_word_id uuid;
    v_session_id uuid;
    v_practiced_at timestamptz;
    v_timezone text;
    v_tags text[];
    v_hints integer;
    v_payload jsonb;
    v_event public.review_events%ROWTYPE;
    v_word public.words%ROWTYPE;
    v_session public.practice_sessions%ROWTYPE;
    v_state public.review_states%ROWTYPE;
    v_interval integer;
    v_ease double precision;
    v_reps integer;
    v_lapses integer;
    v_applied boolean;
BEGIN
    IF p_user_id IS NULL OR p_event IS NULL OR jsonb_typeof(p_event) <> 'object'
       OR NOT (p_event ?& ARRAY['id','word_id','grade','source','practiced_at','timezone'])
       OR (p_event - ARRAY['id','word_id','session_id','grade','source','practiced_at','timezone','answer','feedback','error_tags','hint_count']) <> '{}'::jsonb
       OR p_event->>'grade' IS NULL OR p_event->>'grade' NOT IN ('forgot','fuzzy','known')
       OR p_event->>'source' IS NULL OR p_event->>'source' NOT IN ('web','codex')
       OR (p_event ? 'error_tags' AND jsonb_typeof(p_event->'error_tags') <> 'array')
       OR (p_event ? 'hint_count' AND jsonb_typeof(p_event->'hint_count') <> 'number')
       OR (p_event ? 'answer' AND jsonb_typeof(p_event->'answer') NOT IN ('string','null'))
       OR (p_event ? 'feedback' AND jsonb_typeof(p_event->'feedback') NOT IN ('string','null'))
       OR p_event->>'practiced_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$'
       OR char_length(COALESCE(p_event->>'answer','')) > 8000 OR char_length(COALESCE(p_event->>'feedback','')) > 8000 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_event';
    END IF;
    BEGIN
        v_id := (p_event->>'id')::uuid;
        v_word_id := (p_event->>'word_id')::uuid;
        v_session_id := (p_event->>'session_id')::uuid;
        v_practiced_at := (p_event->>'practiced_at')::timestamptz;
        v_hints := COALESCE((p_event->>'hint_count')::integer, 0);
        SELECT COALESCE(array_agg(value ORDER BY ordinal), '{}'::text[]) INTO v_tags
        FROM jsonb_array_elements_text(COALESCE(p_event->'error_tags','[]'::jsonb)) WITH ORDINALITY AS item(value, ordinal);
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_event';
    END;
    v_timezone := p_event->>'timezone';
    IF v_id IS NULL OR v_word_id IS NULL OR v_practiced_at IS NULL
       OR NOT isfinite(v_practiced_at) OR v_practiced_at < timestamptz '2000-01-01 00:00:00+00'
       OR v_practiced_at > now() + interval '5 minutes'
       OR NOT public.learning_valid_timezone(v_timezone) OR v_hints NOT BETWEEN 0 AND 100
       OR NOT public.learning_valid_text_array(v_tags,20,80) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_event';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_event->'error_tags','[]'::jsonb)) value
        WHERE jsonb_typeof(value) <> 'string') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_event';
    END IF;
    v_payload := jsonb_build_object('id',v_id,'word_id',v_word_id,'session_id',v_session_id,
        'grade',p_event->>'grade','source',p_event->>'source','practiced_at',v_practiced_at,'timezone',v_timezone,
        'answer',p_event->>'answer','feedback',p_event->>'feedback','error_tags',to_jsonb(v_tags),'hint_count',v_hints);
    -- 幂等 ID 先加锁；相同 ID 的并行请求只能有一次产生副作用。
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event:' || v_id::text,0));
    SELECT * INTO v_event FROM public.review_events WHERE id = v_id;
    IF FOUND THEN
        IF v_event.user_id <> p_user_id OR v_event.request_payload <> v_payload THEN
            RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'event_id_conflict';
        END IF;
        -- 重试返回当前排期，避免客户端把旧事件的快照覆盖到新状态。
        SELECT * INTO v_state FROM public.review_states WHERE word_id = v_word_id AND user_id = p_user_id;
        RETURN jsonb_build_object('event',to_jsonb(v_event)-'request_payload','state',
            CASE WHEN v_state.word_id IS NULL THEN NULL ELSE to_jsonb(v_state) END,'replayed',true);
    END IF;
    IF v_session_id IS NOT NULL THEN
        -- 会话关闭与新事件共享行锁，已完成会话不会再接受作答。
        SELECT * INTO v_session FROM public.practice_sessions WHERE id = v_session_id AND user_id = p_user_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'session_not_found'; END IF;
        IF v_session.status <> 'active' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'session_already_closed';
        END IF;
        IF NOT (v_word_id = ANY(v_session.word_ids)) THEN
            RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'word_not_in_session';
        END IF;
    END IF;
    -- 词行是串行化锚点：即使尚无 review_states 行也能正确处理首次并发作答。
    SELECT * INTO v_word FROM public.words WHERE id = v_word_id AND user_id = p_user_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'word_not_found'; END IF;
    INSERT INTO public.review_states(word_id,user_id,due)
    VALUES(v_word_id,p_user_id,(v_practiced_at AT TIME ZONE v_timezone)::date + 1)
    ON CONFLICT(word_id) DO NOTHING;
    SELECT * INTO v_state FROM public.review_states WHERE word_id = v_word_id FOR UPDATE;
    IF v_state.user_id <> p_user_id THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'review_owner_conflict';
    END IF;
    -- 迟到的离线事件只记入历史，不覆盖更新的排期。相同时间的不同事件按到达顺序计算。
    v_applied := v_state.last_reviewed_at IS NULL OR v_practiced_at >= v_state.last_reviewed_at;
    IF v_applied THEN
        v_interval := v_state.interval_days;
        v_ease := v_state.ease;
        v_reps := v_state.reps;
        v_lapses := v_state.lapses;
        IF p_event->>'grade' = 'forgot' THEN
            v_reps := 0;
            v_lapses := v_lapses + 1;
            v_ease := greatest(1.3::double precision,v_ease-0.2::double precision);
            v_interval := 1;
        ELSIF p_event->>'grade' = 'fuzzy' THEN
            v_reps := v_reps + 1;
            v_ease := greatest(1.3::double precision,v_ease-0.15::double precision);
            v_interval := least(365,greatest(1,ceil(v_interval*1.2::double precision)))::integer;
        ELSE
            v_reps := v_reps + 1;
            v_interval := CASE WHEN v_interval < 1 THEN 3 ELSE least(365,ceil(v_interval*v_ease))::integer END;
        END IF;
        UPDATE public.review_states SET interval_days = v_interval, ease = v_ease, reps = v_reps, lapses = v_lapses,
            due = (v_practiced_at AT TIME ZONE v_timezone)::date + v_interval,
            last_reviewed_at = v_practiced_at, updated_at = clock_timestamp()
        WHERE word_id = v_word_id RETURNING * INTO v_state;
    END IF;
    INSERT INTO public.review_events(id,user_id,word_id,session_id,grade,source,practiced_at,timezone,
        answer,feedback,error_tags,hint_count,scheduling_applied,state_after,word_snapshot,request_payload)
    VALUES(v_id,p_user_id,v_word_id,v_session_id,p_event->>'grade',p_event->>'source',v_practiced_at,v_timezone,
        p_event->>'answer',p_event->>'feedback',v_tags,v_hints,v_applied,to_jsonb(v_state),
        jsonb_build_object('id',v_word.id,'word',v_word.word,'meaning',v_word.meaning,'language',v_word.language),v_payload)
    RETURNING * INTO v_event;
    RETURN jsonb_build_object('event',to_jsonb(v_event)-'request_payload','state',to_jsonb(v_state),'replayed',false);
END;
$$;

CREATE FUNCTION public.learning_save_sentence(p_user_id uuid, p_sentence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_words jsonb;
    v_sentence public.saved_sentences%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR p_sentence IS NULL OR jsonb_typeof(p_sentence) <> 'object'
       OR NOT (p_sentence ?& ARRAY['id','sentence','language'])
       OR (p_sentence - ARRAY['id','sentence','sentence_cn','language','scene','source_words']) <> '{}'::jsonb
       OR p_sentence->>'sentence' IS NULL OR char_length(btrim(p_sentence->>'sentence')) NOT BETWEEN 1 AND 8000
       OR jsonb_typeof(p_sentence->'sentence') <> 'string'
       OR (p_sentence ? 'sentence_cn' AND jsonb_typeof(p_sentence->'sentence_cn') NOT IN ('string','null'))
       OR (p_sentence ? 'scene' AND jsonb_typeof(p_sentence->'scene') NOT IN ('string','null'))
       OR char_length(COALESCE(p_sentence->>'sentence_cn','')) > 8000
       OR char_length(COALESCE(p_sentence->>'scene','')) > 500
       OR p_sentence->>'language' IS NULL OR p_sentence->>'language' NOT IN ('en','de')
       OR (p_sentence ? 'source_words' AND jsonb_typeof(p_sentence->'source_words') <> 'array') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_sentence';
    END IF;
    BEGIN
        v_id := (p_sentence->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_sentence';
    END;
    v_words := COALESCE(p_sentence->'source_words','[]'::jsonb);
    IF v_id IS NULL OR jsonb_array_length(v_words) > 100
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_words) AS value
           WHERE jsonb_typeof(value) <> 'string' OR char_length(btrim(value #>> '{}')) NOT BETWEEN 1 AND 200) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'invalid_sentence';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sentence:' || v_id::text,0));
    SELECT * INTO v_sentence FROM public.saved_sentences WHERE id = v_id FOR UPDATE;
    IF FOUND THEN
        IF v_sentence.user_id <> p_user_id OR v_sentence.sentence <> p_sentence->>'sentence'
           OR v_sentence.sentence_cn IS DISTINCT FROM p_sentence->>'sentence_cn'
           OR v_sentence.language <> p_sentence->>'language'
           OR v_sentence.scene IS DISTINCT FROM p_sentence->>'scene'
           OR v_sentence.source_words <> v_words OR v_sentence.source_type <> 'combined' THEN
            RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'sentence_id_conflict';
        END IF;
        RETURN to_jsonb(v_sentence);
    END IF;
    INSERT INTO public.saved_sentences(id,user_id,sentence,sentence_cn,language,scene,source_type,source_words)
    VALUES(v_id,p_user_id,p_sentence->>'sentence',p_sentence->>'sentence_cn',p_sentence->>'language',
        p_sentence->>'scene','combined',v_words) RETURNING * INTO v_sentence;
    RETURN to_jsonb(v_sentence);
END;
$$;

REVOKE ALL ON FUNCTION public.learning_valid_text_array(text[],integer,integer), public.learning_valid_timezone(text),
    public.learning_get_review(uuid,text,text,text,integer,integer), public.learning_create_session(uuid,jsonb),
    public.learning_update_session(uuid,uuid,jsonb), public.learning_record_event(uuid,jsonb),
    public.learning_save_sentence(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learning_valid_text_array(text[],integer,integer), public.learning_valid_timezone(text),
    public.learning_get_review(uuid,text,text,text,integer,integer), public.learning_create_session(uuid,jsonb),
    public.learning_update_session(uuid,uuid,jsonb), public.learning_record_event(uuid,jsonb),
    public.learning_save_sentence(uuid,jsonb) TO service_role;


-- ============================================================
-- 5. 复习状态仅允许事件 API 写入（阶段 4）
-- ============================================================

-- 阶段 4：网页已改为提交 review_events 后再应用本迁移。
-- 旧标签页不再能用离线整行 upsert 覆盖 Codex 或其他设备的新排期。
-- 用户仍通过 words 删除词汇；关联排期由外键 ON DELETE CASCADE 清理。
REVOKE INSERT, UPDATE, DELETE ON public.review_states FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_states TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO service_role;
DROP POLICY IF EXISTS "Users can insert own review states" ON public.review_states;
DROP POLICY IF EXISTS "Users can update own review states" ON public.review_states;
DROP POLICY IF EXISTS "Users can delete own review states" ON public.review_states;


-- ============================================================
-- 6. 混合练习与词汇写入
-- ============================================================

-- 混合材料沿用现有 SRS 选词；新增词汇写入独立授权与幂等收据。
ALTER TABLE public.api_access_tokens DROP CONSTRAINT api_access_tokens_scopes_check;
ALTER TABLE public.api_access_tokens ADD CONSTRAINT api_access_tokens_scopes_check CHECK (
    cardinality(scopes) BETWEEN 1 AND 4
    AND scopes <@ ARRAY['vocabulary:read','vocabulary:write','practice:write','sentences:write']::text[]
    AND array_position(scopes,NULL) IS NULL
);

ALTER TABLE public.practice_sessions ADD COLUMN sentence_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.practice_sessions ALTER COLUMN word_ids SET DEFAULT '{}';
ALTER TABLE public.practice_sessions DROP CONSTRAINT practice_sessions_language_check;
ALTER TABLE public.practice_sessions DROP CONSTRAINT practice_sessions_word_ids_check;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_language_check CHECK (language IN ('en','de','mixed'));
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_material_ids_check CHECK (
    cardinality(word_ids) + cardinality(sentence_ids) BETWEEN 1 AND 100
    AND array_position(word_ids,NULL) IS NULL AND array_position(sentence_ids,NULL) IS NULL
);

CREATE TABLE public.word_write_requests (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 不级联删除收据，旧请求不能复活用户已删除的词。
    word_id uuid NOT NULL,
    request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'),
    created boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.word_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.word_write_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.word_write_requests TO service_role;
CREATE INDEX idx_word_write_requests_user ON public.word_write_requests(user_id,created_at);
CREATE INDEX idx_words_owner_normalized ON public.words(user_id,language,lower(btrim(word)));

CREATE FUNCTION public.learning_get_practice_materials(
    p_user_id uuid,
    p_language text DEFAULT NULL,
    p_timezone text DEFAULT NULL,
    p_limit integer DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_timezone text;
    v_review jsonb;
    v_words_available integer;
    v_sentences_available integer;
    v_word_count integer;
    v_sentence_count integer;
    v_due integer;
    v_words jsonb;
    v_sentences jsonb;
BEGIN
    IF p_user_id IS NULL OR (p_language IS NOT NULL AND p_language NOT IN ('en','de'))
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_material_query';
    END IF;
    SELECT COALESCE(p_timezone,(SELECT timezone FROM public.learning_preferences WHERE user_id=p_user_id),'Europe/Berlin') INTO v_timezone;
    -- 排序、时区、缺失状态回填与在线复习完全共用，不另造遗忘曲线或重置进度。
    v_review:=public.learning_get_review(p_user_id,p_language,'all',v_timezone,p_limit,0);
    v_words_available:=(v_review#>>'{meta,counts,total_tracked}')::integer;
    SELECT count(*)::integer INTO v_sentences_available FROM public.saved_sentences
        WHERE user_id=p_user_id AND (p_language IS NULL OR language=p_language);
    v_sentence_count:=CASE WHEN v_words_available>0 AND p_limit>=2
        THEN least(v_sentences_available,greatest(1,p_limit/5)) ELSE 0 END;
    v_word_count:=least(v_words_available,p_limit-v_sentence_count);
    v_sentence_count:=least(v_sentences_available,p_limit-v_word_count);
    v_due:=least(v_word_count,(v_review#>>'{meta,counts,due}')::integer);
    -- 仅相同到期日随机打散；到期优先级始终不变，且候选来自完整词库。
    SELECT COALESCE(jsonb_agg(entry ORDER BY due,sample),'[]'::jsonb) INTO v_words FROM (
        SELECT jsonb_build_object('kind','word','word',to_jsonb(w),'state',to_jsonb(s)) AS entry,
            s.due,random() AS sample
        FROM public.words w JOIN public.review_states s ON s.word_id=w.id AND s.user_id=w.user_id
        WHERE w.user_id=p_user_id AND (p_language IS NULL OR w.language=p_language)
        ORDER BY s.due,sample LIMIT v_word_count
    ) picked;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','sentence','sentence',to_jsonb(picked))),'[]'::jsonb)
    INTO v_sentences FROM (
        SELECT * FROM public.saved_sentences WHERE user_id=p_user_id AND (p_language IS NULL OR language=p_language)
        ORDER BY random() LIMIT v_sentence_count
    ) picked;
    RETURN jsonb_build_object('data',v_words||v_sentences,'meta',jsonb_build_object(
        'available',v_words_available+v_sentences_available,'count',v_word_count+v_sentence_count,
        'words_available',v_words_available,'sentences_available',v_sentences_available,'timezone',v_timezone,
        'selection',jsonb_build_object('due',v_due,'ahead',v_word_count-v_due,'sentences',v_sentence_count)
    ));
END;
$$;

CREATE OR REPLACE FUNCTION public.learning_create_session(p_user_id uuid, p_session jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_words uuid[];
    v_sentences uuid[];
    v_payload jsonb;
    v_session public.practice_sessions%ROWTYPE;
    v_item record;
    v_minutes integer;
BEGIN
    IF p_user_id IS NULL OR p_session IS NULL OR jsonb_typeof(p_session)<>'object'
       OR NOT (p_session ?& ARRAY['id','language','mode'])
       OR (p_session-ARRAY['id','language','mode','topic','word_ids','sentence_ids','target_minutes'])<>'{}'::jsonb
       OR (p_session ? 'word_ids' AND jsonb_typeof(p_session->'word_ids')<>'array')
       OR (p_session ? 'sentence_ids' AND jsonb_typeof(p_session->'sentence_ids')<>'array')
       OR (p_session ? 'topic' AND jsonb_typeof(p_session->'topic')<>'string')
       OR (p_session ? 'target_minutes' AND jsonb_typeof(p_session->'target_minutes')<>'number')
       OR p_session->>'language' IS NULL OR p_session->>'language' NOT IN ('en','de','mixed')
       OR p_session->>'mode' IS NULL OR p_session->>'mode' NOT IN ('conversation','recall','cloze')
       OR char_length(COALESCE(p_session->>'topic',''))>500 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_session';
    END IF;
    BEGIN
        v_id:=(p_session->>'id')::uuid;
        SELECT COALESCE(array_agg(value::uuid ORDER BY ordinal),'{}'::uuid[]) INTO v_words
            FROM jsonb_array_elements_text(COALESCE(p_session->'word_ids','[]'::jsonb)) WITH ORDINALITY item(value,ordinal);
        SELECT COALESCE(array_agg(value::uuid ORDER BY ordinal),'{}'::uuid[]) INTO v_sentences
            FROM jsonb_array_elements_text(COALESCE(p_session->'sentence_ids','[]'::jsonb)) WITH ORDINALITY item(value,ordinal);
        v_minutes:=COALESCE((p_session->>'target_minutes')::integer,10);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_session';
    END;
    IF v_id IS NULL OR cardinality(v_words)+cardinality(v_sentences) NOT BETWEEN 1 AND 100
       OR array_position(v_words,NULL) IS NOT NULL OR array_position(v_sentences,NULL) IS NOT NULL
       OR cardinality(v_words)<>(SELECT count(DISTINCT id) FROM unnest(v_words) id)
       OR cardinality(v_sentences)<>(SELECT count(DISTINCT id) FROM unnest(v_sentences) id)
       OR v_minutes NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_session';
    END IF;
    v_payload:=jsonb_build_object('id',v_id,'language',p_session->>'language','mode',p_session->>'mode',
        'topic',COALESCE(p_session->>'topic',''),'word_ids',to_jsonb(v_words),'sentence_ids',to_jsonb(v_sentences),'target_minutes',v_minutes);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('session:'||v_id::text,0));
    SELECT * INTO v_session FROM public.practice_sessions WHERE id=v_id;
    IF FOUND THEN
        -- 旧会话创建收据没有 sentence_ids，空数组保持原请求可重试。
        IF v_session.user_id<>p_user_id OR (v_session.initial_payload||jsonb_build_object('sentence_ids',COALESCE(v_session.initial_payload->'sentence_ids','[]'::jsonb)))<>v_payload THEN
            RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='session_id_conflict';
        END IF;
        RETURN to_jsonb(v_session)-'initial_payload';
    END IF;
    FOR v_item IN SELECT * FROM public.words WHERE id=ANY(v_words) ORDER BY id FOR KEY SHARE LOOP
        IF v_item.user_id<>p_user_id OR (p_session->>'language'<>'mixed' AND v_item.language<>p_session->>'language') THEN
            RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='word_not_found';
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.words WHERE id=ANY(v_words) AND user_id=p_user_id)<>cardinality(v_words) THEN
        RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='word_not_found';
    END IF;
    FOR v_item IN SELECT * FROM public.saved_sentences WHERE id=ANY(v_sentences) ORDER BY id FOR KEY SHARE LOOP
        IF v_item.user_id<>p_user_id OR (p_session->>'language'<>'mixed' AND v_item.language<>p_session->>'language') THEN
            RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='sentence_not_found';
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.saved_sentences WHERE id=ANY(v_sentences) AND user_id=p_user_id)<>cardinality(v_sentences) THEN
        RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='sentence_not_found';
    END IF;
    INSERT INTO public.practice_sessions(id,user_id,language,mode,topic,word_ids,sentence_ids,target_minutes,initial_payload)
    VALUES(v_id,p_user_id,p_session->>'language',p_session->>'mode',COALESCE(p_session->>'topic',''),v_words,v_sentences,v_minutes,v_payload)
    RETURNING * INTO v_session;
    RETURN to_jsonb(v_session)-'initial_payload';
END;
$$;

CREATE FUNCTION public.learning_save_word(p_user_id uuid,p_word jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_word public.words%ROWTYPE;
    v_request public.word_write_requests%ROWTYPE;
    v_payload jsonb;
    v_word_text text;
    v_meaning text;
    v_language text;
    v_category text;
    v_date date;
    v_created boolean:=false;
    v_timezone text;
BEGIN
    IF p_user_id IS NULL OR p_word IS NULL OR jsonb_typeof(p_word)<>'object'
       OR NOT (p_word ?& ARRAY['id','word','meaning','language'])
       OR (p_word-ARRAY['id','word','meaning','language','example','example_cn','category','date','etymology'])<>'{}'::jsonb
       OR jsonb_typeof(p_word->'word')<>'string' OR jsonb_typeof(p_word->'meaning')<>'string'
       OR p_word->>'word' IS NULL OR char_length(btrim(p_word->>'word')) NOT BETWEEN 1 AND 200
       OR p_word->>'meaning' IS NULL OR char_length(btrim(p_word->>'meaning')) NOT BETWEEN 1 AND 4000
       OR p_word->>'language' IS NULL OR p_word->>'language' NOT IN ('en','de')
       OR COALESCE(p_word->>'category','') NOT IN ('daily','professional','formal','')
       OR EXISTS (SELECT 1 FROM jsonb_each(p_word) entry WHERE entry.key IN ('example','example_cn','etymology','category','date')
            AND jsonb_typeof(entry.value) NOT IN ('string','null'))
       OR char_length(COALESCE(p_word->>'example',''))>4000 OR char_length(COALESCE(p_word->>'example_cn',''))>4000
       OR char_length(COALESCE(p_word->>'etymology',''))>8000 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word';
    END IF;
    BEGIN
        v_id:=(p_word->>'id')::uuid;
        IF p_word->>'date' IS NOT NULL THEN
            IF p_word->>'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
                RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word_date';
            END IF;
            v_date:=(p_word->>'date')::date;
        END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word';
    END;
    IF v_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word'; END IF;
    v_word_text:=btrim(p_word->>'word'); v_meaning:=btrim(p_word->>'meaning');
    v_language:=p_word->>'language'; v_category:=COALESCE(p_word->>'category','');
    -- 缺省 date 原样记为 null；跨午夜/偏好变更重试仍是同一请求。
    v_payload:=jsonb_build_object('id',v_id,'word',v_word_text,'meaning',v_meaning,'language',v_language,
        'example',COALESCE(p_word->>'example',''),'example_cn',COALESCE(p_word->>'example_cn',''),
        'category',v_category,'date',v_date,'etymology',COALESCE(p_word->>'etymology',''));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('word-request:'||v_id::text,0));
    SELECT * INTO v_request FROM public.word_write_requests WHERE id=v_id;
    IF FOUND THEN
        IF v_request.user_id<>p_user_id OR v_request.request_payload<>v_payload THEN
            RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='word_request_conflict';
        END IF;
        SELECT * INTO v_word FROM public.words WHERE id=v_request.word_id AND user_id=p_user_id;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='word_no_longer_exists'; END IF;
        RETURN jsonb_build_object('word',to_jsonb(v_word),'created',v_request.created,'duplicate',NOT v_request.created,'replayed',true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.words WHERE id=v_id) THEN
        RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='word_id_conflict';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('word-key:'||p_user_id::text||':'||v_language||':'||lower(v_word_text),0));
    SELECT * INTO v_word FROM public.words WHERE user_id=p_user_id AND language=v_language
        AND lower(btrim(word))=lower(v_word_text) ORDER BY created_at,id LIMIT 1 FOR KEY SHARE;
    IF NOT FOUND THEN
        SELECT COALESCE((SELECT timezone FROM public.learning_preferences WHERE user_id=p_user_id),'Europe/Berlin') INTO v_timezone;
        INSERT INTO public.words(id,user_id,word,meaning,language,example,example_cn,category,date,etymology)
        VALUES(v_id,p_user_id,v_word_text,v_meaning,v_language,p_word->>'example',p_word->>'example_cn',v_category,
            COALESCE(v_date,(now() AT TIME ZONE v_timezone)::date),p_word->>'etymology') RETURNING * INTO v_word;
        v_created:=true;
    END IF;
    INSERT INTO public.word_write_requests(id,user_id,word_id,request_payload,created)
    VALUES(v_id,p_user_id,v_word.id,v_payload,v_created);
    RETURN jsonb_build_object('word',to_jsonb(v_word),'created',v_created,'duplicate',NOT v_created,'replayed',false);
END;
$$;

REVOKE ALL ON FUNCTION public.learning_get_practice_materials(uuid,text,text,integer),public.learning_create_session(uuid,jsonb),
    public.learning_save_word(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.learning_get_practice_materials(uuid,text,text,integer),public.learning_create_session(uuid,jsonb),
    public.learning_save_word(uuid,jsonb) TO service_role;
