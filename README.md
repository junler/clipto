# Clipto

> 一款轻量的 macOS 剪贴板历史管理工具，常驻菜单栏，随时快速访问复制记录。  

### 可以通过brew安装：

```bash
brew install --cask junler/clipto/clipto 
``` 
- https://github.com/junler/homebrew-clipto/

## 功能特性

- 📋 **自动记录**：实时监听剪贴板变化，自动保存复制内容
- 📌 **置顶固定**：支持将常用条目置顶，清空时不受影响
- ✏️ **编辑内容**：可对历史记录进行二次编辑，并支持一键还原原始内容
- 🗑 **删除 / 清空**：单条删除或一键清空未置顶记录
- 💾 **持久化存储**：历史记录保存至 `~/.clipto/history.json`，重启后不丢失
- 🖥 **双窗口设计**：
  - **Popup 弹框**：点击菜单栏图标弹出，展示最近 6 条记录，一键复制
  - **主窗口**：查看、搜索、管理全部历史记录
- 🔒 **最多保留 200 条**未置顶记录，自动淘汰最旧条目
- 🚫 **隐藏 Dock 图标**：纯菜单栏应用，不占用 Dock 空间

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Rust + Tauri v2 |
| 剪贴板 | [arboard](https://github.com/1Password/arboard) |
| 数据存储 | JSON 文件（本地持久化） |

## 开发环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 10
- [Rust](https://www.rust-lang.org/) (stable)
- [Tauri CLI v2](https://tauri.app/)

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发模式（同时启动 Vite 和 Tauri）
pnpm tauri dev

# 构建生产包
pnpm tauri build
```

## 项目结构

```
Clipto/
├── src/                  # React 前端源码
│   ├── App.tsx           # 主组件（Popup 弹框 + 主窗口）
│   └── App.css           # 样式
├── src-tauri/            # Rust 后端源码
│   ├── src/
│   │   ├── lib.rs        # 核心逻辑（剪贴板监听、命令、托盘）
│   │   └── main.rs       # 入口
│   └── tauri.conf.json   # Tauri 配置
├── index.html
├── vite.config.ts
└── package.json
```

## 问题

- 提示文件已损坏，可以使用这个命令修复
xattr -rd com.apple.quarantine /Applications/clipto.app

- 软件图标没有出现在启动台
defaults write com.apple.dock ResetLaunchPad -bool true; killall Dock

- 更新cask的文件
brew update

## License

MIT © 2026 junler
