-- ============================================================
-- 句子输入支持：放宽 source_type 约束 + 新增 keywords / grammar 列
-- 在 Supabase Dashboard → SQL Editor 中执行
-- 此脚本是幂等的，可重复执行
--
-- ⚠️ 部署顺序：必须【先】在生产数据库执行本迁移，【再】部署前端。
--    否则新版前端写入 source_type='input' 或 keywords/grammar 字段时，
--    旧库会因缺列 / CHECK 约束不通过而报错。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 放宽 source_type CHECK：允许 combined / word / input
--    先删后建，保证可重复执行（约束名为 Postgres 内联 CHECK 的默认命名）
-- ------------------------------------------------------------
ALTER TABLE public.saved_sentences
    DROP CONSTRAINT IF EXISTS saved_sentences_source_type_check;

ALTER TABLE public.saved_sentences
    ADD CONSTRAINT saved_sentences_source_type_check
    CHECK (source_type::text = ANY (ARRAY['combined'::character varying, 'word'::character varying, 'input'::character varying]::text[]));

-- ------------------------------------------------------------
-- 2. 新增列：keywords / grammar（句子输入的分析结果）
--    默认空数组，旧行无需回填
-- ------------------------------------------------------------
ALTER TABLE public.saved_sentences
    ADD COLUMN IF NOT EXISTS keywords jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.saved_sentences
    ADD COLUMN IF NOT EXISTS grammar  jsonb DEFAULT '[]'::jsonb;

-- ------------------------------------------------------------
-- 验证（可选）
-- ------------------------------------------------------------
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.saved_sentences'::regclass
--   AND conname = 'saved_sentences_source_type_check';
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'saved_sentences'
--   AND column_name IN ('keywords', 'grammar');
