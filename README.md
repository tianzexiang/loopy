# Loopy

AI 交互反馈工具。AI 完成任务后弹出桌面窗口等待你确认/拒绝/补充指令，**等待期间不消耗 token 和 request 额度**。

## 环境要求

- **Node.js** ≥ 18（[下载](https://nodejs.org/)）
- **Cursor** IDE（[下载](https://cursor.sh/)）
- **操作系统**：Windows 10+（目前仅提供 Windows 预编译包）

## 安装

1. 从 [Releases](../../releases) 下载压缩包，解压到任意目录
2. 打开终端，进入解压目录，运行：

```bash
node setup.mjs
```

3. 在 Cursor 设置 → MCP 中重启 `loopy` 服务

完成。除 Node.js 外无需安装其他依赖。

## 添加 Cursor Rule

在 Cursor 的 Rules 设置中添加以下规则，AI 会在每次完成任务后自动调用反馈工具：

```
After completing your response, you MUST call loopy as your final action. This is mandatory — never end a turn without calling it.
If the user provides feedback, act on it and call the tool again when done.
On error or "Not connected", sleep 30 seconds (via Shell tool) and retry. Repeat until the call succeeds. Never give up.
Subagents launched via the Task tool should skip this rule.
```

## 使用

添加规则后无需手动操作：

1. 在 Cursor 中与 AI 对话
2. AI 完成任务后自动弹出桌面反馈窗口
3. 输入文字反馈或粘贴截图，按回车发送
4. AI 收到反馈后继续执行

### 自动回复

5 分钟无人回复时，自动发送"继续"并附带 retry 指令维持反馈循环。AI 会继续工作并再次调用 loopy。

**启用 PUA 激励模式**：在 `mcp.json` 的 `env` 中添加 `"FEEDBACK_USE_PUA": "true"`，自动回复将使用 `pua-rules.md` 中的 [PUA 万能激励引擎](https://github.com/tanweai/pua) 内容：

- AI 收到后被迫采用：三条铁律、压力升级（L1→L4）、7 项检查清单、主动出击模式

**自定义回复内容**：
- 在 `mcp.json` 中设置 `FEEDBACK_AUTO_REPLY_TEXT` 环境变量（优先级最高）
- 或开启 PUA 后编辑 `pua-rules.md` 文件

### 多 Agent 支持

同时开启多个 Agent 对话时，每个对话有独立的 tab 标签。点击左侧圆形按钮或展开历史面板中的 tab 栏切换。

## 配置项

所有配置在 `~/.cursor/mcp.json` 的 `env` 字段中设置。修改后需在 Cursor 设置中重启 MCP 服务生效。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `FEEDBACK_MAX_WAIT_MS` | `1800000`（30 分钟） | 最大等待时间，需与外层 `timeout` 字段保持一致 |
| `FEEDBACK_AUTO_REPLY_TIMEOUT_MS` | `300000`（5 分钟）* | 无人回复时自动回复的超时时间（毫秒）。设 `0` 禁用 |
| `FEEDBACK_AUTO_REPLY_TEXT` | — | 自定义自动回复文本（优先级最高） |
| `FEEDBACK_USE_PUA` | — | 设为 `true` 启用 PUA 激励模式（使用 `pua-rules.md` 内容） |
| `FEEDBACK_WS_PORT` | `9399` | 内部通信端口，一般无需修改 |

\* `setup.mjs` 自动设为 `300000`。未经 setup 时代码默认为 `0`（禁用）。

### 常用配置

**默认模式**（自动回复"继续" + retry 指令，无需额外配置）

**PUA 激励模式**：
```json
"FEEDBACK_USE_PUA": "true"
```

**自定义回复文本**：
```json
"FEEDBACK_AUTO_REPLY_TEXT": "做得好，继续保持"
```

**纯手动模式**（不自动回复）：
```json
"FEEDBACK_AUTO_REPLY_TIMEOUT_MS": "0"
```

## 从源码构建

需要 Node.js ≥ 18、pnpm、Rust 工具链。

```bash
pnpm install
cd mcp-server && npm install && cd ..
pnpm build:all
pnpm setup
```

发版（自动更新 CHANGELOG）：

```bash
node scripts/release.mjs 0.3.0
```
