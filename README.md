# DeepSeek Sidebar Organizer

<p align="center"><img src="icons/icon-128.png" alt="DeepSeek Sidebar Organizer icon" width="128"></p>

仅在 `https://chat.deepseek.com/*` 运行的 Chromium 浏览器扩展，用于整理 DeepSeek 会话并增强主聊天区滚动条。

## 功能

- 高对比度主聊天滚动条，可设置宽度、轨道颜色和滑块颜色。
- 对话滚动位置百分比、“顶部 / 最新”快捷按钮。
- 侧边栏“时间 / 分组”切换；官方时间列表保持不变。
- 本地分组：创建、重命名、删除、展开和收起分组。
- 在官方会话菜单中将对话加入多个分组。

## 隐私

不读取或上传聊天正文。滚动条设置保存到 `chrome.storage.sync`；分组名称、会话标题和链接保存到本地 `chrome.storage.local`。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录，即包含 `manifest.json` 的目录。
5. 修改文件后，在扩展管理页点击扩展的刷新按钮，再刷新 DeepSeek 页面。

## 使用

- 点击工具栏扩展图标，调整滚动条开关、宽度和颜色。
- 在侧边栏切换到“分组”，创建和浏览分组。
- 在官方会话右侧三点菜单底部选择“加入分组”。
