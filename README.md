# 词汇本 (Vocab Tracker)

一个基于 AI 的多语言词汇学习应用，支持英语和德语。输入单词后，AI 自动生成中文翻译、情境例句，并提供高质量语音朗读。

![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)
![Vite](https://img.shields.io/badge/Vite-7.3-646CFF?logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?logo=tailwind-css)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai)

## ✨ 功能特性

- **🤖 AI 智能翻译**：使用 OpenAI GPT-4o-mini 自动生成准确的中文翻译
- **📝 情境例句**：根据词汇性质（日常/专业/正式）生成匹配的例句
- **✨ 组合造句**：随机选取多个已记录的单词，AI 生成包含这些单词的句子，加深记忆
- **📍 场景标签**：根据单词类别自动标注句子适用场景（日常对话/职场交流等）
- **⭐ 句子收藏**：收藏喜欢的例句和组合造句，云端同步
- **🔊 高质量语音**：使用 OpenAI TTS 提供自然的语音朗读（英语 / 德语）
- **🇬🇧🇩🇪 双语支持**：同时支持英语和德语词汇
- **📊 学习统计**：实时显示总词汇量、各语言数量和今日新增
- **🔍 快速搜索**：支持按单词或翻译搜索
- **📅 按日期分组**：词汇按添加日期自动分组显示
- **📤 CSV 导出**：支持导出词汇数据
- **☁️ 云端同步**：使用 Supabase 存储，跨设备同步数据

## 🚀 快速开始

### 前提条件

- Node.js 19+
- npm 或 pnpm
- **OpenAI API Key（必需）**：[获取地址](https://platform.openai.com/api-keys)
  > ⚠️ **注意**：没有 OpenAI API Key 将无法使用本项目的 AI 翻译、例句生成和语音朗读功能。应用启动后会提示您输入 API Key。

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd vocab-tracker

# 安装依赖
npm install
```

### 配置 API Key

**方式一：环境变量（推荐）**

创建 `.env` 文件：

```env
VITE_OPENAI_API_KEY=sk-proj-xxxxx
```

**方式二：应用内设置**

启动应用后，点击右上角的设置图标 ⚙️，输入 API Key。

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

## 📁 项目结构

```
vocab-tracker/
├── src/
│   ├── App.jsx         # 主应用组件
│   ├── index.css       # 样式表
│   └── main.jsx        # 入口文件
├── .vscode/
│   ├── launch.json     # VS Code 调试配置
│   └── tasks.json      # VS Code 任务配置
├── index.html          # HTML 模板
├── vite.config.js      # Vite 配置（含 API 代理）
├── package.json        # 项目依赖
├── .env                # 环境变量（需自行创建）
└── .gitignore          # Git 忽略规则
```

## 🔧 技术架构

### 前端

| 技术 | 用途 |
|------|------|
| React 19 | UI 框架 |
| Vite 7 | 构建工具 |
| Tailwind CSS 4 | 样式系统 |
| Supabase | 云存储 & 认证 |
| Space Grotesk | 字体 |

### AI 服务

| 服务 | 用途 |
|------|------|
| OpenAI GPT-4o-mini | 翻译 & 例句生成 |
| OpenAI GPT-4o-mini-tts | 语音朗读 (2025 新模型) |
| Web Speech API | 备用发音（无 API Key 时使用） |

### API 代理

应用通过 Vite 开发服务器代理 OpenAI API 请求，避免浏览器 CORS 限制：

```
/api/openai/* → https://api.openai.com/*
```

## 🎨 使用指南

### 添加单词

1. 点击 **添加** 按钮
2. 选择语言（英语 🇬🇧 / 德语 🇩🇪）
3. 输入单词或短语
4. 等待 AI 自动生成翻译和例句
5. 点击 **保存**

### 发音播放

点击任意单词即可播放 OpenAI TTS 语音朗读。

> **🔊 关于语音机制的技术说明 (2025 优化版)**
> 
> 1. **旗舰模型**：已升级使用 **`gpt-4o-mini-tts`** 模型。
>    - *优势*：相比旧版 `tts-1`，拥有更强的情感理解力，语调更自然，且性价比极高。
>    - *配置*：统一使用 **`nova`** 声音（女声），在英语和德语下均表现出众。
> 
> 2. **稳定性优化**：
>    - **防截断 ("Single Word Bug" Fix)**：针对 OpenAI TTS 朗读短单词容易吞尾音的问题，代码会自动为短词添加智能后缀，引导模型完整发音。
>    - **指数退避重试 (Exponential Backoff)**：网络请求失败时，采用 0.5s → 1s → 2s 的指数级等待策略，大幅提升弱网环境下的成功率。
> 
> 3. **智能缓存**：
>    - 单词首次播放请求 API（消耗 Token），音频自动存入内存。
>    - 再次点击**零延迟秒开**，不消耗任何额度。

### 重新生成例句

将鼠标悬停在例句上，点击右侧的 ↻ 按钮生成新例句。

### 组合造句

1. 点击 **🇬🇧 英语** 或 **🇩🇪 德语** Tab
2. 点击 **✨ 组合造句** 按钮
3. AI 会随机选取 2-4 个单词，生成包含这些单词的句子
4. 句子上方显示 **📍 场景标签**（如日常对话、职场交流等）
5. 点击 **换一批** 重新生成

### 收藏句子

1. 在组合造句面板或单词例句处点击 **⭐ 收藏** 按钮
2. 点击 **⭐ 收藏** Tab 查看所有收藏的句子
3. 支持朗读和移除收藏

### 导出数据

点击右上角的 **导出** 按钮，下载 CSV 格式的词汇数据。

## 🛠️ 开发调试

### VS Code 调试

项目已配置 VS Code 调试环境，直接在调试面板选择 `Debug React App` 即可。

调试会自动启动 Vite 开发服务器并打开 Chrome。

### 构建生产版本

```bash
npm run build
```

构建产物位于 `dist/` 目录。

### 预览生产版本

```bash
npm run preview
```

## 🌐 Supabase 配置

### 首次设置

如果你是首次部署此项目，需要在 Supabase 中创建数据库表。

👉 **详细指南请参阅 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**

### 生产环境配置

项目上线发布后，为确保**邮件重置密码**功能正常跳转，需在 Supabase 后台完成以下配置：

1.  登录 [Supabase Dashboard](https://supabase.com/dashboard) 并进入本项目。
2.  导航至 **Authentication** > **URL Configuration**。
3.  **Site URL**: 设置为你的生产环境主域名（例如 `https://your-domain.com`）。
4.  **Redirect URLs**: 添加你的生产环境 URL（例如 `https://your-domain.com/**`）。
    - ⚠️ **注意**：重置密码邮件中的链接会跳转到此 URL。若未配置正确，用户点击邮件链接后将无法回到应用设置新密码。
5.  **Email Templates** (可选): 在 **Authentication** > **Email Templates** 中检查 "Reset Password" 模板，确保 `{{ .ConfirmationURL }}` 宏被正确包含。

## 📝 注意事项

- API Key 存储在浏览器本地，请勿在公共设备上使用
- 词汇数据和收藏句子保存在 Supabase 云端，跨设备同步
- 建议定期导出词汇备份

## 📄 License

MIT
