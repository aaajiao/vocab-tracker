# Vocab Tracker Pake 打包指南

本文档记录了如何使用 [Pake](https://github.com/tw93/Pake) 将 Vocab Tracker 网站打包为 macOS 桌面应用。

## 1. 前置要求

在开始之前，请确保您的统已安装以下环境：

- **Node.js**:用于运行 npm 命令。
- **Rust**: Pake 依赖 Rust 进行编译。
  - 检查命令：`rustc --version`
  - 安装命令（如未安装）：
    ```bash
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```

## 2. 安装 Pake CLI

推荐使用 npm 全局安装 `pake-cli`：

```bash
npm install -g pake-cli
```

## 3. 准备应用图标

macOS 应用需要 `.icns` 格式的图标。如果您只有 `.png` 图片，可以通过以下步骤生成：

1. 准备一张高分辨率（推荐 1024x1024）的 PNG 图片，例如 `logo.png`。
2. 创建临时目录并生成不同尺寸的图标：
    ```bash
    mkdir VocabTracker.iconset
    sips -z 16 16     logo.png --out VocabTracker.iconset/icon_16x16.png
    sips -z 32 32     logo.png --out VocabTracker.iconset/icon_16x16@2x.png
    sips -z 32 32     logo.png --out VocabTracker.iconset/icon_32x32.png
    sips -z 64 64     logo.png --out VocabTracker.iconset/icon_32x32@2x.png
    sips -z 128 128   logo.png --out VocabTracker.iconset/icon_128x128.png
    sips -z 256 256   logo.png --out VocabTracker.iconset/icon_128x128@2x.png
    sips -z 256 256   logo.png --out VocabTracker.iconset/icon_256x256.png
    sips -z 512 512   logo.png --out VocabTracker.iconset/icon_256x256@2x.png
    sips -z 512 512   logo.png --out VocabTracker.iconset/icon_512x512.png
    sips -z 1024 1024 logo.png --out VocabTracker.iconset/icon_512x512@2x.png
    ```
3. 生成 `.icns` 文件：
    ```bash
    iconutil -c icns VocabTracker.iconset
    ```
   此时会生成 `VocabTracker.icns`，您可以删除 `VocabTracker.iconset` 目录。

## 4. 运行打包命令

在终端中运行以下命令即可生成应用。

**参数说明：**
- `https://...`: 您的网站地址（推荐使用线上地址以支持热更新）。
- `--name`: 应用名称。
- `--icon`: 图标路径。
- `--hide-title-bar`: 隐藏标题栏，获得沉浸式体验。
- `--width` / `--height`: 初始窗口宽高。

**打包命令：**

```bash
pake https://vocab-tracker-sigma.vercel.app/ --name "VocabTracker" --icon "public/VocabTracker.icns" --hide-title-bar --height 1000 --width 450
```

## 5. 输出结果

命令执行成功后，当前目录下会生成 `VocabTracker.dmg` 文件。

- 双击打开 DMG 文件。
- 将 `VocabTracker` 拖入 `Applications` 文件夹即可安装。
