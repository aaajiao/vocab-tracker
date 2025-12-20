# Vocab Tracker (词汇本)

[English](#english) | [中文](#chinese)

---

<a name="english"></a>
## 🇬🇧 English

A multi-language vocabulary learning application powered by AI, supporting English and German. Enter a word, and AI automatically generates Chinese translations, contextual examples, and provides high-quality voice pronunciation.

![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)
![Vite](https://img.shields.io/badge/Vite-7.3-646CFF?logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?logo=tailwind-css)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai)

### ✨ Features

- **🌓 Dark Mode**: Manual toggle for Light/Dark themes with persistence.
- **⚡ Performance**: Implemented window-level virtual scrolling for smooth handling of large vocabulary lists.
- **🤖 AI Translation**: Automatically generates accurate Chinese translations using OpenAI GPT-4o-mini.
- **📝 Contextual Examples**: Generates matching sentences based on word nature (Daily/Professional/Formal).
- **✨ Combined Sentence Creation**: Randomly selects multiple saved words and AI generates a sentence containing them to reinforce memory.
- **📍 Scene Tags**: Automatically tags sentences with applicable scenes (e.g., Daily Conversation, Workplace).
- **⭐ Saved Sentences**: Save your favorite examples and combined sentences, synced to the cloud.
- **🔊 High-Quality Audio**: Natural voice pronunciation using OpenAI TTS with visual feedback indicators.
- **🇬🇧🇩🇪 Bilingual Support**: Supports both English and German vocabulary.
- **📊 Statistics**: Real-time display of total vocabulary, count by language, and daily additions.
- **🔍 Quick Search**: Search by word or translation.
- **📅 Date Grouping**: Vocabulary automatically grouped by addition date.
- **📤 CSV Export**: Support for exporting vocabulary data.
- **☁️ Cloud Sync**: Uses Supabase for storage, ensuring data sync across devices.
- **📱 PWA Ready**: Supports dark/light mode Apple Touch Icons for home screen installation.

### 🚀 Quick Start

#### Prerequisites

- Node.js 19+
- npm or pnpm
- **OpenAI API Key (Required)**: [Get it here](https://platform.openai.com/api-keys)
  > ⚠️ **Note**: Without an OpenAI API Key, the AI translation, example generation, and TTS features will not function. The app will prompt you for the key upon launch.

#### Installation

```bash
# Clone repository
git clone <repository-url>
cd vocab-tracker

# Install dependencies
npm install
```

#### Configure API Key

**Method 1: Environment Variable (Recommended)**

Create a `.env` file:

```env
VITE_OPENAI_API_KEY=sk-proj-xxxxx
```

**Method 2: In-App Settings**

Launch the app, click the settings icon ⚙️ in the top right, and enter your API Key.

#### Start Development Server

```bash
npm run dev
```

Visit http://localhost:5173

### 📁 Project Structure

```
vocab-tracker/
├── src/
│   ├── App.jsx         # Main Application Component
│   ├── index.css       # Stylesheet
│   └── main.jsx        # Entry Point
├── .vscode/            # VS Code Config
├── index.html          # HTML Template
├── vite.config.js      # Vite Config
├── package.json        # Dependencies
└── .env                # Environment Variables
```

### 🔧 Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4
- **Backend/Storage**: Supabase
- **AI Services**: OpenAI GPT-4o-mini (Translation), GPT-4o-mini-tts (Audio)

### 🎨 Usage Guide

1.  **Add Word**: Click "Add", select language, enter word. AI generates content. Click "Save".
2.  **Play Audio**: Click any word to play pronunciation.
3.  **Make Sentence**: Review "English" or "German" tabs, click "✨ Combined Sentence" to generate a sentence from random words.
4.  **Favorites**: Save sentences to the "⭐ Favorites" tab.

### 🌐 Supabase Configuration

This project requires a Supabase backend. Please refer to [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed setup instructions.

### 📝 Changelog

#### v1.2.0 (2025-12-20)
- **🏗️ Code Refactoring**: Modularized codebase into components, services, and hooks.
- **⚡ Performance**: Added `React.memo`, `useCallback`, and `useMemo` optimizations.
- **↩️ Undo Delete**: Added 5-second undo toast for accidental deletions.
- **🛡️ Error Boundary**: Added graceful error handling with recovery option.
- **🌓 Theme Persistence**: User theme choice now persists across sessions.

#### v1.1.0 (2025-12-20)
- **🌓 Dark Mode**: Added manual theme toggle with persistent storage.
- **⚡ Virtual Scrolling**: Implemented window-level virtualization for improved performance.
- **🎨 UI/UX Enhancements**: Added visual indicators for audio generation and updated brand assets.
- **📱 PWA Optimization**: Added adaptive Apple Touch Icons for Dark Mode.

#### v1.0.0 (2025-12-20)
- **Initial Release**: Complete vocabulary tracking features.
- **Multi-language**: English and German support.
- **AI Integration**: Translation, example generation, and TTS.
- **Cloud Sync**: Supabase integration.
- **Documentation**: Bilingual README and Setup Guide.

---

<a name="chinese"></a>
## 🇨🇳 中文

一个基于 AI 的多语言词汇学习应用，支持英语和德语。输入单词后，AI 自动生成中文翻译、情境例句，并提供高质量语音朗读。

### ✨ 功能特性

- **🌓 深色模式**：手动切换浅色/深色主题，支持状态持久化存储
- **⚡ 性能优化**：实现窗口级虚拟滚动，流畅处理海量词汇列表
- **🤖 AI 智能翻译**：使用 OpenAI GPT-4o-mini 自动生成准确的中文翻译
- **📝 情境例句**：根据词汇性质（日常/专业/正式）生成匹配的例句
- **✨ 组合造句**：随机选取多个已记录的单词，AI 生成包含这些单词的句子，加深记忆
- **📍 场景标签**：根据单词类别自动标注句子适用场景（日常对话/职场交流等）
- **⭐ 句子收藏**：收藏喜欢的例句和组合造句，云端同步
- **🔊 高质量语音**：使用 OpenAI TTS 提供自然的语音朗读，并带有视觉状态反馈
- **🇬🇧🇩🇪 双语支持**：同时支持英语和德语词汇
- **📊 学习统计**：实时显示总词汇量、各语言数量和今日新增
- **🔍 快速搜索**：支持按单词或翻译搜索
- **📅 按日期分组**：词汇按添加日期自动分组显示
- **📤 CSV 导出**：支持导出词汇数据
- **☁️ 云端同步**：使用 Supabase 存储，跨设备同步数据
- **📱 PWA 支持**：适配 iOS 主屏幕深浅色模式图标

### 🚀 快速开始

#### 前提条件

- Node.js 19+
- npm 或 pnpm
- **OpenAI API Key（必需）**：[获取地址](https://platform.openai.com/api-keys)
  > ⚠️ **注意**：没有 OpenAI API Key 将无法使用本项目的 AI 翻译、例句生成和语音朗读功能。应用启动后会提示您输入 API Key。

#### 安装

```bash
# 克隆项目
git clone <repository-url>
cd vocab-tracker

# 安装依赖
npm install
```

#### 配置 API Key

**方式一：环境变量（推荐）**

创建 `.env` 文件：

```env
VITE_OPENAI_API_KEY=sk-proj-xxxxx
```

**方式二：应用内设置**

启动应用后，点击右上角的设置图标 ⚙️，输入 API Key。

#### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

### 📁 项目结构

```
vocab-tracker/
├── src/
│   ├── App.jsx         # 主应用组件
│   ├── index.css       # 样式表
│   └── main.jsx        # 入口文件
├── .vscode/            # VS Code配置
├── index.html          # HTML 模板
├── vite.config.js      # Vite 配置
├── package.json        # 项目依赖
└── .env                # 环境变量
```

### 🔧 技术架构

- **前端**: React 19, Vite 7, Tailwind CSS 4
- **后端/存储**: Supabase
- **AI 服务**: OpenAI GPT-4o-mini (翻译), GPT-4o-mini-tts (语音)

### 🎨 使用指南

1.  **添加单词**: 点击 "添加", 选择语言, 输入单词. AI 自动生成内容. 点击 "保存".
2.  **播放语音**: 点击任意单词播放读音.
3.  **组合造句**: 在 "英语" 或 "德语" 标签页下, 点击 "✨ 组合造句" 生成包含随机单词的句子.
4.  **收藏**: 将喜欢的句子保存到 "⭐ 收藏" 列表.

### 🌐 Supabase 配置

本项目需要 Supabase 后端支持。详细设置请参阅 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)。

### 📝 更新日志 (Changelog)

#### v1.2.0 (2025-12-20)
- **🏗️ 代码重构**: 模块化拆分代码为组件、服务和 Hooks，提升可维护性。
- **⚡ 性能优化**: 添加 `React.memo`、`useCallback`、`useMemo` 优化。
- **↩️ 撤销删除**: 误删单词后 5 秒内可撤销恢复。
- **🛡️ 错误边界**: 添加优雅的错误处理和恢复机制。
- **🌓 主题持久化**: 用户的主题选择现在会跨会话保存。

#### v1.1.0 (2025-12-20)
- **🌓 深色模式**: 添加手动主题切换，支持持久化存储。
- **⚡ 虚拟滚动**: 实现窗口级虚拟滚动，大幅提升长列表性能。
- **🎨 UI/UX 优化**: 增加语音状态反馈动画，优化界面细节。
- **📱 PWA 优化**: 添加适配深色模式的 Apple Touch Icon。

#### v1.0.0 (2025-12-20)
- **首次发布**: 完整的词汇记录功能.
- **多语言支持**: 支持英语和德语.
- **AI 集成**: 翻译, 例句生成, 语音朗读.
- **云端同步**: Supabase 数据同步.
- **文档**: 双语 README 和 设置指南.

## 📄 License

MIT
