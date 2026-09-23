# Migrations

按日期命名的一次性 SQL 迁移脚本，记录数据库 schema / 权限的演进过程。

**新项目无需运行这些文件** —— 直接在 Supabase SQL Editor 完整执行 [`schema.sql`](../schema.sql)，即可创建三张应用表及其索引、显式授权和 RLS 策略。设置步骤见 [`SUPABASE_SETUP.md`](../SUPABASE_SETUP.md)。

这些文件保留下来仅作为：

- 历史变更记录
- 升级老项目（在迁移日期之前已上线的项目）的参考

## Data API 默认授权变更

Supabase 从 2026-05-30 起逐步为新项目停用 `public` 新建表的默认授权；从 2026-10-30 起，现有项目也停止对之后新建的表自动授权。**已有表的权限会保留**，详见 [官方公告 #45329](https://github.com/orgs/supabase/discussions/45329)。

历史 grants 迁移用于显式声明应用需要的权限、提前准备兼容性，并不表示公告会撤销已有表的权限。历史 SQL 原样保留；其中的日期注释应按上述范围理解。新增表应继续显式配置所需的 `GRANT` 和 RLS；如果旧默认授权已经给 `anon` 权限，仍需用 `REVOKE` 收回。

## 文件命名规范

`YYYY-MM-DD_NN_<short_description>.sql`

例：`2026-05-13_01_grants_migration.sql`

## 迁移列表

| 日期 | 文件 | 目的 |
|---|---|---|
| 2026-05-13 | `2026-05-13_01_grants_migration.sql` | 为 `words` / `saved_sentences` 显式补 GRANT，提前准备默认授权变更的兼容性；已有表权限不会因公告被撤销 |
| 2026-05-13 | `2026-05-13_02_revoke_anon.sql` | 收紧 anon 角色权限，移除两表上 anon 的全部 grant（应用不需要匿名访问业务数据） |
| 2026-07-07 | `2026-07-07_01_sentence_input.sql` | 句子输入支持：放宽 `saved_sentences.source_type` CHECK（新增 `input`），新增 `keywords` / `grammar` jsonb 列。⚠️ 必须先执行本迁移再部署前端 |
| 2026-07-07 | `2026-07-07_02_review_states.sql` | 复习功能（SRS）：新增 `review_states` 表（PK `word_id`，FK → `words(id)` ON DELETE CASCADE），含 `user_id, due` 索引、grants 与 RLS。未执行时前端优雅降级（复习状态仅存本地），执行后进度可跨设备同步 |
