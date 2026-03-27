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

### 自动回复文本 (`pua-rules.md`)

项目根目录的 `pua-rules.md` 为自动回复的默认内容（PUA 激励方法论）。运行时由 MCP server 读取。优先级：`FEEDBACK_AUTO_REPLY_TEXT` 环境变量 > `pua-rules.md` 文件 > `"继续"` fallback。

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

## 开发环境搭建

```bash
# 安装依赖
pnpm install
cd mcp-server && npm install && cd ..

# 前端开发（热重载）
pnpm dev

# MCP 服务端开发
cd mcp-server && npm run dev

# Tauri 开发模式
npx tauri dev
```

## 构建

```bash
# 一键构建（含 tsc + bundle + tauri build）
pnpm build:all

# 分步构建
cd mcp-server && npm run build && npm run bundle && cd ..
npx tauri build

# 生成 release 包
node scripts/release.mjs
```

## 配置到 Cursor

```bash
pnpm setup
```
