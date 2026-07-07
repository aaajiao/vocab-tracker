# Migrations

按日期命名的一次性 SQL 迁移脚本，记录数据库 schema / 权限的演进过程。

**新项目无需运行这些文件** —— 直接按 [`../SUPABASE_SETUP.md`](../SUPABASE_SETUP.md) 建表即可，最新的权限规则已经合并进建表脚本。

这些文件保留下来仅作为：
- 历史变更记录
- 升级老项目（在迁移日期之前已上线的项目）的参考

## 文件命名规范

`YYYY-MM-DD_NN_<short_description>.sql`

例：`2026-05-13_01_grants_migration.sql`

## 迁移列表

| 日期 | 文件 | 目的 |
|---|---|---|
| 2026-05-13 | `2026-05-13_01_grants_migration.sql` | 为 `words` / `saved_sentences` 显式补 GRANT，应对 Supabase 2026-10-30 起对 public schema 默认权限的强制变更 |
| 2026-05-13 | `2026-05-13_02_revoke_anon.sql` | 收紧 anon 角色权限，移除两表上 anon 的全部 grant（应用不需要匿名访问业务数据） |
| 2026-07-07 | `2026-07-07_01_sentence_input.sql` | 句子输入支持：放宽 `saved_sentences.source_type` CHECK（新增 `input`），新增 `keywords` / `grammar` jsonb 列。⚠️ 必须先执行本迁移再部署前端 |
