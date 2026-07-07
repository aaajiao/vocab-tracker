-- ============================================================
-- 复习功能（SRS）：新增 review_states 表
-- 在 Supabase Dashboard → SQL Editor 中执行
-- 此脚本是幂等的，可重复执行
--
-- ⚠️ 部署顺序：建议【先】在生产数据库执行本迁移，【再】部署前端。
--    未执行时前端会优雅降级（复习状态仅存本地 IndexedDB、pending 保留），
--    但只有建表后复习进度才能跨设备同步。
--
-- 授权与 RLS 完全照搬 words 表模式：
--   GRANT SELECT/INSERT/UPDATE/DELETE 给 authenticated 与 service_role，不给 anon；
--   启用 RLS，四条策略均 auth.uid() = user_id。
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
    CONSTRAINT review_states_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id)
);

-- 索引：按用户 + 到期日查询「今日到期」
CREATE INDEX IF NOT EXISTS idx_review_states_user_due ON public.review_states(user_id, due);

-- Data API 授权（同 words 表策略，anon 无任何权限）
-- 注意：Supabase 对 public schema 有默认授权，CREATE TABLE 时会自动把全部权限
-- 授给 anon，必须显式 REVOKE 收掉（同 2026-05-13_02_revoke_anon.sql 的处理）。
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

-- ------------------------------------------------------------
-- 验证（可选）
-- ------------------------------------------------------------
-- SELECT table_name, grantee,
--     string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'review_states'
--   AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
-- GROUP BY table_name, grantee
-- ORDER BY grantee;
