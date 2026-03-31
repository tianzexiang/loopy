# 开发指南

## 项目架构

```
IDE ←stdio→ MCP Server (Node.js) ←WebSocket→ GUI (Tauri + Vue)
```

### MCP Server (`mcp-server/`)

Node.js/TypeScript 服务端，通过 stdio 与 IDE 通信，通过 WebSocket 与 GUI 通信。

- `src/index.ts` — MCP 工具定义、session 池、GUI 启动逻辑、自动回复配置
- `src/ws-bridge.ts` — WebSocket 客户端，事件驱动响应
- `src/types.ts` — 共享类型定义
- `src/logger.ts` — 日志工具

### 自动回复机制

自动回复默认关闭（`FEEDBACK_AUTO_REPLY_TIMEOUT_MS=0`）。开启后的行为：

1. MCP server 将 `autoReplyTimeout` 和 `autoReplyText` 附在 `FeedbackRequest` 中发给 GUI
2. GUI 的 `scheduleAutoReply` 启动定时器，超时后发送带 `isAutoReply: true` 标记的响应
3. MCP server 收到自动回复后，在返回给 IDE 的 tool result 末尾追加 retry 指令，确保 AI 继续调用 loopy

自动回复文本优先级：`FEEDBACK_AUTO_REPLY_TEXT` 环境变量 > `pua-rules.md` 文件（需 `FEEDBACK_USE_PUA=true`） > `"继续"` fallback。

### GUI (`src/` + `src-tauri/`)

Tauri v2 + Vue 3 桌面应用。

**Rust 层** (`src-tauri/src/`)：
- `lib.rs` — 应用入口，CLI 参数解析
- `ws_server.rs` — WebSocket 服务端，定向路由

**Vue 层** (`src/`)：
- `stores/sessions.ts` — 核心状态管理（连接层 + session 层分离）
- `composables/useWindowLayout.ts` — 窗口动画
- `components/` — UI 组件

### 关键设计决策

1. **连接层与 session 层分离**：WebSocket 断连不影响 pendingRequest
2. **事件驱动响应**：WsBridge 用 Promise + 回调替代轮询
3. **定向路由**：响应只发给目标 MCP 实例，不广播
4. **Session 池**：同一 MCP 进程复用空闲 session
5. **自动回复 retry 标记**：`isAutoReply` 字段区分自动/手动回复，仅自动回复追加 retry 指令

## 开发环境搭建

### 前置要求

- Node.js ≥ 18
- pnpm
- Rust 工具链（[安装](https://www.rust-lang.org/tools/install)）

### 首次搭建

```bash
# 1. 安装所有依赖
pnpm install
cd mcp-server && npm install && cd ..

# 2. 构建 MCP server（生成 dist/）
cd mcp-server && npm run build && cd ..

# 3. 注册 MCP server 到 Cursor
pnpm setup

# 4. 在 Cursor 设置 → MCP 中重启 loopy 服务
```

`pnpm setup` 会自动检测项目布局并将正确路径写入 `~/.cursor/mcp.json`：
- 开发环境指向 `mcp-server/dist/bundle.mjs`（如有）或 `mcp-server/dist/index.js`
- 发布包指向同目录下的 `server.mjs`

示例生成的配置（开发环境，路径因机器而异）：
```json
{
  "mcpServers": {
    "loopy": {
      "command": "node",
      "args": ["D:/code/xxx/dist/index.js"],
      "timeout": 1800000,
      "autoApprove": ["loopy"],
      "env": {
        "FEEDBACK_MAX_WAIT_MS": "1800000",
        "FEEDBACK_AUTO_REPLY_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

### 日常开发

项目有两个独立部分需要开发：

**GUI 开发**（Tauri + Vue，支持热重载）：
```bash
npx tauri dev
```
这个命令会同时启动 Vite 前端热重载和 Tauri 桌面窗口。修改 `src/` 下的 Vue 代码会自动刷新，修改 `src-tauri/src/` 下的 Rust 代码会自动重新编译。

**MCP server 开发**：
MCP server 由 Cursor 通过 stdio 启动，不需要手动运行。修改 `mcp-server/src/` 下的代码后：
```bash
cd mcp-server && npm run build && cd ..
# 然后在 Cursor 设置 → MCP 中重启 loopy 服务
```

> 提示：如果只改 GUI 不改 MCP server，不需要重启 MCP 服务。

## 类型检查

```bash
# Vue 前端
pnpm exec vue-tsc --noEmit

# MCP 服务端
cd mcp-server && npx tsc --noEmit
```

## 构建

```bash
# 一键构建（含 tsc + bundle + tauri build）
pnpm build:all

# 分步构建
cd mcp-server && npm run build && npm run bundle && cd ..
npx tauri build
```

## 发版

```bash
# 自动更新 CHANGELOG + 构建 + 打包
node scripts/release.mjs 0.3.0

# 不更新 CHANGELOG（手动管理）
node scripts/release.mjs
```

传入版本号时，脚本从上一个 git tag 到 HEAD 提取 commit 记录，自动写入 `CHANGELOG.md`。打包产物在 `release/loopy/` 目录。
