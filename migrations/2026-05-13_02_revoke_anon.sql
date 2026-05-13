-- ============================================================
-- 收紧 anon 角色权限：移除 words / saved_sentences 上的所有权限
-- 本应用所有数据都需登录访问，anon 不需要任何权限
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ============================================================

REVOKE ALL ON public.words FROM anon;
REVOKE ALL ON public.saved_sentences FROM anon;

-- ------------------------------------------------------------
-- 验证：anon 应该不再出现在结果中
-- ------------------------------------------------------------
SELECT
    table_name,
    grantee,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('words', 'saved_sentences')
  AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;
