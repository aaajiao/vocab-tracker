-- 阶段 4：网页已改为提交 review_events 后再应用本迁移。
-- 旧标签页不再能用离线整行 upsert 覆盖 Codex 或其他设备的新排期。
-- 用户仍通过 words 删除词汇；关联排期由外键 ON DELETE CASCADE 清理。
REVOKE INSERT, UPDATE, DELETE ON public.review_states FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_states TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO service_role;
DROP POLICY IF EXISTS "Users can insert own review states" ON public.review_states;
DROP POLICY IF EXISTS "Users can update own review states" ON public.review_states;
DROP POLICY IF EXISTS "Users can delete own review states" ON public.review_states;
