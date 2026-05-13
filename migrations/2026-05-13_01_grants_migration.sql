-- ============================================================
-- Supabase Data API 显式授权迁移
-- 适配 2026-10-30 起对现有项目强制执行的 public schema 默认权限变更
-- 在 Supabase Dashboard → SQL Editor 中执行
-- 此脚本是幂等的，可重复执行
-- ============================================================

-- ------------------------------------------------------------
-- words 表
-- ------------------------------------------------------------

-- authenticated: 登录用户（受 RLS 限制，只能操作自己的数据）
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.words
    TO authenticated;

-- service_role: 后台/服务端绕过 RLS 的全权访问
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.words
    TO service_role;

-- 注意：本项目所有 words 行都属于某个登录用户，anon 角色无需任何访问权限
-- 因此故意不向 anon 授权（即便授了，RLS 也会拦下来）

-- 确认 RLS 已启用（你已经启用过，这里再次声明保险）
ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- saved_sentences 表
-- ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.saved_sentences
    TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.saved_sentences
    TO service_role;

ALTER TABLE public.saved_sentences ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 验证（可选）：查看两张表的最终授权情况
-- ------------------------------------------------------------
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('words', 'saved_sentences')
-- ORDER BY table_name, grantee, privilege_type;
