# DeepSeek Sidebar Organizer 维护说明

## 项目概览

这是一个 Chromium Manifest V3 扩展，仅运行在 `https://chat.deepseek.com/*`。

主要功能：

- 增强 DeepSeek 主聊天区域滚动条，提供醒目的滑块、顶部/最新按钮和滚动百分比。
- 在官方侧边栏旁增加“分组”视图，用于创建、编辑、删除、折叠和拖拽排序分组，并把会话加入多个分组。
- 分组支持颜色、图标和置顶标记，并可清理当前官方侧边栏中未找到的会话。
- 点击分组中的会话时，借用官方会话链接完成导航，同时保持在自定义分组页。

## 重要文件

- `manifest.json`：扩展清单、权限、内容脚本和弹出页配置。
- `content.js`：内容脚本主入口，负责滚动条增强、侧边栏分组 UI、官方菜单注入、会话导航和 MutationObserver。
- `content.css`：滚动条及滚动控制按钮样式。
- `content-groups.css`：分组侧边栏、分组菜单和悬浮下拉菜单样式。
- `groups.js`：分组状态的规范化、会话增删、分组操作回放和存储记录格式；不直接操作 DOM。
- `settings.js`：滚动条设置默认值、颜色校验和宽度范围校验。
- `popup.html` / `popup.js` / `popup.css`：扩展弹出设置页。
- `tests/`：Node 内置测试，覆盖滚动条、设置、弹出页和分组数据逻辑。

内容脚本加载顺序是 `settings.js` → `groups.js` → `content.js`，后者依赖前两个脚本挂载到 `globalThis` 的 API。

## 数据存储

滚动条设置保存在 `chrome.storage.sync`。分组数据保存在 `chrome.storage.local`：

- `dsaGroups`：当前版本化快照，格式为 `{ version, revision, state }`。
- `dsaGroupsBackup`：上一次快照，用于恢复较新的有效数据。
- `dsaGroupsOp:<id>`：分组操作日志，用于异步写入或多页面场景下回放操作；自动只保留最新 100 条。

分组会话使用 `{ href, title }` 保存，分组使用稳定的 `id`。修改分组状态时应优先通过 `commitGroupOperation()`，不要直接改对象后自行保存，否则可能绕过操作日志和写入队列。

## 菜单和分组 UI 注意事项

- 官方会话菜单通过 `[role="menu"].ds-dropdown-menu` 查找。
- 自定义“加入分组”插入在“多选”和“删除”之间，类名为 `.dsa-group-menu-option`。
- “加入分组”采用悬浮打开方式：鼠标进入或键盘获得焦点时显示右侧 `#dsa-group-menu`；菜单项本身不负责点击打开。
- 右侧分组按钮的点击才会执行 `add-chat` 操作。
- 分组排序使用 `reorder-groups` 操作；置顶分组显示在普通分组之前，拖拽时分别调整各自区域内的顺序。
- “清理未找到”只依据当前已加载的官方会话链接判断，缺失也可能表示官方列表尚未加载完整，执行前会二次确认。
- 分组头部悬浮后可使用“标记”按钮设置颜色、图标和置顶；左侧的拖拽手柄用于调整顺序。
- 自定义侧边栏根节点是 `#dsa-sidebar-groups`。查找官方会话链接时必须排除该节点，避免自定义链接被再次识别为官方链接。
- DeepSeek 的 DOM 类名和菜单结构可能变化，修改选择器时应保留空值保护，并手动验证官方菜单顺序和深浅色主题。

## 开发与验证

项目没有构建步骤，修改后运行：

```powershell
node --check content.js
node --check groups.js
npm test
git diff --check
```

浏览器手动验证：在 `chrome://extensions/` 重新加载解压扩展，再刷新 DeepSeek 页面；测试官方菜单、分组悬浮菜单、加入/移除会话、切换分组页和滚动条设置。

修改存储格式时要同步更新 `groups.js` 的规范化和回放逻辑，并补充分组测试，避免旧数据因页面异步初始化或并发写入而丢失。
