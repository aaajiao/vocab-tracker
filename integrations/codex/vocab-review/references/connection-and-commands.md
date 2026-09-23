# 连接、命令和恢复

运行环境为 Bun。下文 `vocab` 表示 `bun <Skill 绝对路径>/scripts/vocab.ts`；不创建依赖当前终端的永久 alias。

## 首次连接

在 Vocab Tracker 网站登录，在 Codex 连接设置中创建个人访问令牌；选择 `vocabulary:read`，需要保存练习时加 `practice:write`，需要添加新词时加 `vocabulary:write`，需要收藏句时加 `sentences:write`。已有令牌不会因为客户端升级自动获得新权限。

用户在交互终端运行：

```text
bun /实际的/skill/目录/scripts/vocab.ts configure --url https://你的生词本域名 --storage keychain
```

随后在隐藏输入中粘贴令牌。不要让用户在聊天里发令牌，不从浏览器会话或系统现有凭据中自行提取。不要把令牌放进 shell 参数、命令历史、环境配置源码或项目文件。macOS 默认使用 Keychain，由随 Skill 打包的 `keychain.swift` 通过系统 Swift 和 Security.framework 读写，凭据只从标准输入传递；因此 Keychain 方式需要本机可运行 Swift。其他系统、Swift 不可用或用户明确选择本地文件时用 `--storage file`，文件权限 0600、目录 0700。

URL 只接受 HTTPS 网站根地址或 `/api/v1`；HTTP 仅允许 localhost/127.0.0.1/::1。不会跟随重定向，以防授权头泄露。测试环境可同时设置 `VOCAB_API_URL` / `VOCAB_API_TOKEN`；它们不落盘。`VOCAB_CONFIG_DIR` 可隔离测试目录。

`status` 只显示账号、权限、网站、保存方式和待写入数量。`logout` 移除本地凭据；撤销云端令牌需在网站操作。已排队请求保留并绑定原账号，换账号不会错误重放。

## 读取

```text
vocab status
vocab materials
vocab materials --limit 10
vocab materials --language de --limit 10
vocab preferences
vocab review --language de --mode due --timezone Europe/Berlin --limit 8
vocab words --language de --q Arbeit --limit 10
vocab words --ids <uuid>,<uuid>
vocab sentences --language de --q Gespräch
vocab sessions --status active --limit 5
vocab resume <session-uuid>
vocab events --word-id <word-uuid> --limit 5
vocab events --session-id <session-uuid>
```

普通开始练习用 `materials`，默认 `limit=10`，默认不传语言、不按旧偏好限制语言或条数。只在用户明确指定时传 `--language en|de`、`--limit` 或 `--timezone`。服务端沿用在线 SRS：较早到期的词优先，同一到期日期内可从完整词库随机选择，穿插收藏句，到期词耗尽才选提前复习的词。CLI 不重新随机抽词绕过优先级，实际作答使用原有复习曲线。材料返回结构为：

```text
{kind:"word", word:<真实词条>, state:<当前复习状态或 null>}
{kind:"sentence", sentence:<真实收藏句>}
```

`meta` 包含 `available`、`count`、`words_available`、`sentences_available`、`selection:{due,ahead,sentences}` 和 `timezone`。材料不重复，少于请求数时返回已有材料；按当次目标数量（默认 10 项，用户指定数量则遵从）组织不同练法，来源不足时可透明复用、空库时先添加。纯句子练习使用真实句子 ID 记录会话，不创建虚构单词评分。

其他列表返回 `{data,meta}`，其中 `meta.has_more` 和 `meta.next_offset` 用于下一页 `--offset`；`materials` 不分页。`review` 复习项仍为 `{word,state}`，保留给用户明确要求到期列表等情形。使用返回的真实 UUID。云端尚未同步的离线新增材料不会出现。

## 写入

写入用 `--json -` 从标准输入读取，或 `--json /绝对路径/request.json`。临时 JSON 文件若含私人作答应使用 0600，成功后删除；不要在 shell 字符串中拼接用户内容。输出为 JSON，可检查 `data` 和 `request_id`。

| 命令 | JSON 正文字段 |
|---|---|
| `start --json -` | `id?`, `language` (`en`/`de`/`mixed`), `mode` (`conversation`/`recall`/`cloze`), `topic`, `word_ids?`, `sentence_ids?`, `target_minutes?` |
| `event --json -` | `id?`, `word_id`, `session_id?`, `grade` (`forgot`/`fuzzy`/`known`), `practiced_at?`, `timezone?`, `answer?`, `feedback?`, `error_tags?`, `hint_count?` |
| `add-word --json -` | `id?`, `word`, `meaning`（中文）, `language` (`en`/`de`), `example?`, `example_cn?`, `category?`（默认 `""`）, `date?`（YYYY-MM-DD，省略由服务端按账号时区取日期）, `etymology?` |
| `save-sentence --json -` | `id?`, `sentence`, `sentence_cn`, `language`, `scene`, `source_words` |
| `preferences-set --json -` | 已明确要长期保存的 `language`, `timezone`, `session_size`, `duration_minutes`, `correction_style`, `interests` 子集 |
| `finish <session-uuid> --json -` | `expected_version`（来自刚读的 `resume`）、`summary`、`status`（默认 `completed`，也可 `abandoned`） |

CLI 在第一次发送前固定 UUID，作答自动加 `source: "codex"`、当前 ISO 时间和本机时区；通常应显式传材料返回的时区和实际作答时间。客户端不接受 `user_id`。服务端负责权限、所有权、排期和内容验证。会话的 `word_ids` 与 `sentence_ids` 都可以为空数组，但合计需要 1–100 个真实材料 ID；纯句子会话不要求建词。

会话开启正文示例：

```json
{"language":"mixed","mode":"conversation","topic":"本轮词句练习","word_ids":["使用真实词UUID"],"sentence_ids":["使用真实句子UUID"]}
```

作答正文示例：

```json
{"word_id":"使用真实词UUID","session_id":"使用真实会话UUID","grade":"fuzzy","timezone":"Europe/Berlin","answer":"用户的实际短答","feedback":"需提示后才选对冠词","error_tags":["article"],"hint_count":1}
```

`save-sentence.source_words` 沿用词库的原文字形；不要传虚构 UUID 当成词。

用户明确说“加入生词本”时，根据上下文判断词或句、英语或德语，补齐准确的中文释义/中译即可写入，不追问分类或再次确认保存。若 status 已知缺少 `vocabulary:write`，不发送 add-word、不创建 pending，提示在网站现有连接开启“允许保存新词”，保留当前令牌。新获得的添加权限只用于所指条目，不恢复用户已要求停止保存的会话、作答或总结。新增单词正文示例：

```json
{"word":"die Zusage","meaning":"同意；承诺；肯定答复","language":"de","example":"Ich habe eine Zusage bekommen.","example_cn":"我收到了肯定答复。"}
```

`add-word` 返回 `{data:<词条>,meta:{created,duplicate,replayed}}`。`created:true` 才计作新增；`duplicate:true` 表示词已存在且未被覆盖，使用返回的词 ID。API 按相同语言、去首尾空格且不区分大小写的词形去重，保留已有词的内容。重试使用原 UUID，不因响应丢失再造一个新词。新增请求和复习评分是独立动作：添加成功本身不记作已复习。

## 中断、失败和重试

每次写入先把稳定 ID、账号、请求正文保存到本地安全目录；成功后移除。这里只存尚未确认的请求、最小会话句柄和绑定当前凭据摘要的已验证账号，不维护本地词库。连接验证过后，即使网络突然中断，真实作答也能先排队。可能含简短作答，因此不要随意展示或上传该目录。

- `pending` 列出待写入请求元数据；`retry <request-id>` 用原请求和 ID 重发。只读和稳定 ID 的 POST 最多自动尝试 3 次，单次超时 10 秒；PATCH 不自动重试。
- 401/403 表示令牌或权限问题：停止写入，重新连接或调整权限后恢复。409 不循环重试、不换新事件 ID；先 `resume` / `events` 确认服务器现状。
- `finish` 响应丢失时，先 `resume` 检查：若已完成且总结正确，可 `discard <request-id>` 删除本地重复请求；若仍 active，用最新版本明确恢复。不要对已经 completed 的会话再记作答。
- `discard` 仅丢弃本地请求，不能撤回服务器结果；仅在已核实它已成功或用户明确放弃时使用。用户说“停止，不要保存”后不调用远程 finish/abandoned、不重试作答；该要求明确覆盖本次待写入时，只丢弃对应本地请求。已经确认保存的历史仍保留，不擅自删除。
- 恢复练习用 `sessions --status active` 和 `resume` 返回的会话、总结和已记录事件。纯句子练习没有逐题事件；若上下文丢失且没有保存明确进度，不能宣称准确恢复题号，读总结后简短确认或说明无法核实上次位置再继续已知材料。不要因为 Codex 上下文丢失就把同一组已完成作答重新评分。

只读令牌不能 start/event/finish/add-word/save-sentence，但仍可通过 materials、review、words、sentences 和历史展开练习。权限不足时说明需要哪项权限，未成功的新增或作答不宣称已保存，也不要求用户中断练习。
