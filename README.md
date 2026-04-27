# gpt-img2-mcp

轻量级 stdio MCP server，用于通过 CLIProxyAPI / CPA 或兼容 OpenAI Images API 的服务调用 `gpt-image-2` 生图与编辑。

本 MCP **暴露四个工具**：

```text
generate_image
generate_image_with_size
edit_image
edit_image_with_size
```

默认生图工具 `generate_image` 的可用参数 **只有一个**：

```json
{
  "prompt": "你的生图提示词"
}
```

尺寸覆盖生图工具 `generate_image_with_size` 的参数是：

```json
{
  "prompt": "你的生图提示词",
  "size": "1536x1024"
}
```

默认编辑工具 `edit_image` 的参数是：

```json
{
  "prompt": "在原图基础上做什么修改",
  "image_url": "https://example.com/input.png"
}
```

尺寸覆盖编辑工具 `edit_image_with_size` 的参数是：

```json
{
  "prompt": "在原图基础上做什么修改",
  "image_url": "data:image/png;base64,...",
  "size": "1536x1024"
}
```

其中 `image_url` 支持 HTTPS URL，也支持 data URL（`data:image/...;base64,...`）。

其他所有参数，例如 base URL、API key、模型、质量、输出格式、流式开关、保存目录等，都通过 OpenCode 的 `opencode.jsonc` MCP 配置手动传入。

---

## 适用场景

- 你已经有 CPA / CLIProxyAPI 服务。
- CPA 支持 `/v1/images/generations` 和 `/v1/images/edits`。
- 你想在 OpenCode 里通过 MCP 快速生成图片或基于已有图片编辑。
- 你希望默认 MCP 工具接口保持极简，调用时只填 `prompt`。
- 你也希望在需要时通过另一个工具仅额外覆盖本次请求的 `size`。
- 你希望默认走流式请求，降低长耗时生图请求的超时概率。

---

## 重点特性

> **重点：MCP 默认使用流式生图（`stream: true`）。**
>
> 默认流式可以降低长耗时图片请求在非流式模式下的超时风险。MCP 会消费 SSE 事件，并且只保存完成态的最终图片。

> **重点：中间事件不会落盘。**
>
> 流式过程中的 partial image 事件只会计数到结果元数据，不会作为本地文件保存。

> **重点：当前提供 4 个工具，覆盖生图与编辑。**
>
> - `generate_image`
> - `generate_image_with_size`
> - `edit_image`
> - `edit_image_with_size`

> **重点：编辑接口走 JSON `image_url`，不走 multipart。**
>
> 编辑请求调用 `/v1/images/edits`，请求体使用 `images: [{ image_url: "..." }]`。本轻量 MCP 不支持 multipart 上传与 mask 参数。

> **重点：prompt 没有被固定。**
>
> MCP 工具和 OpenCode 命令都使用用户本次传入的提示词；命令文件使用 `$ARGUMENTS` 作为 prompt。

> **重点：默认调用 Images API（生图 + 编辑）。**
>
> 实际请求地址为：
>
> ```text
> ${GPT_IMG2_BASE_URL}/images/generations
> ${GPT_IMG2_BASE_URL}/images/edits
> ```

> **重点：默认模型是 `gpt-image-2`。**
>
> 你也可以通过 `GPT_IMG2_MODEL` 覆盖。

> **重点：图片会保存到本地目录。**
>
> 默认保存到 MCP 进程当前工作目录，也可以通过 `GPT_IMG2_OUTPUT_DIR` 指定。

---

## 手动安装

### 1. 准备 Node.js

要求：

```text
Node.js >= 20
```

检查版本：

```bash
node --version
```

### 2. 克隆或进入项目目录

```bash
cd /path/to/gpt-img2-mcp
```

### 3. 安装依赖

```bash
npm install
```

### 4. 运行测试

```bash
npm test
```

### 5. 本地启动 MCP

通常不需要手动启动，OpenCode 会根据 `opencode.jsonc` 自动拉起 MCP。

如果需要手动检查：

```bash
node ./src/server.js
```

这是 stdio MCP server，直接运行后会等待 MCP 客户端通过 stdin/stdout 通信，因此终端不会像 HTTP 服务那样打印访问地址。

---

## OpenCode 配置方法（重点）

在你的 OpenCode 配置文件 `opencode.jsonc` 中添加 MCP 配置。

> **重点：OpenCode 的 local MCP 配置中，`command` 是数组，环境变量字段叫 `environment`。**
>
> 也就是：
>
> - `command`: `['node', '/absolute/path/to/gpt-img2-mcp/src/server.js']`
> - `environment`: MCP 进程启动时注入的环境变量

示例：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "gpt-img2": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/gpt-img2-mcp/src/server.js"
      ],
      "enabled": true,
      "environment": {
        "GPT_IMG2_BASE_URL": "https://your-cpa-domain.example/v1",
        "GPT_IMG2_API_KEY": "your-cpa-api-key",

        "GPT_IMG2_MODEL": "gpt-image-2",
        "GPT_IMG2_SIZE": "1024x1024",
        "GPT_IMG2_QUALITY": "high",
        "GPT_IMG2_OUTPUT_FORMAT": "png",
        "GPT_IMG2_RESPONSE_FORMAT": "b64_json",
        "GPT_IMG2_STREAM": "true",

        "GPT_IMG2_OUTPUT_DIR": "/absolute/path/to/save/images"
      }
    }
  }
}
```

> **不要在 OpenCode 配置里写成 `"command": "node"` + `"args": [...]` + `"env": {...}`。**
>
> 那是一些 stdio MCP 客户端常见的拆分写法，不是 OpenCode 官方 local MCP 配置格式。

---

## 通用 stdio MCP 客户端配置格式

如果你不是在 OpenCode 中使用，而是在其他支持 stdio MCP 的客户端中使用，本项目本质上仍是一个 stdio MCP server。

部分 stdio MCP 客户端会使用下面这种拆分格式：

```jsonc
{
  "mcpServers": {
    "gpt-img2": {
      "command": "node",
      "args": [
        "/absolute/path/to/gpt-img2-mcp/src/server.js"
      ],
      "env": {
        "GPT_IMG2_BASE_URL": "https://your-cpa-domain.example/v1",
        "GPT_IMG2_API_KEY": "your-cpa-api-key",

        "GPT_IMG2_MODEL": "gpt-image-2",
        "GPT_IMG2_SIZE": "1024x1024",
        "GPT_IMG2_QUALITY": "high",
        "GPT_IMG2_OUTPUT_FORMAT": "png",
        "GPT_IMG2_RESPONSE_FORMAT": "b64_json",
        "GPT_IMG2_STREAM": "true",

        "GPT_IMG2_OUTPUT_DIR": "/absolute/path/to/save/images"
      }
    }
  }
}
```

> **重点：上面是通用 stdio MCP 客户端示例，不是 OpenCode 示例。**
>
> 在 OpenCode 中请使用上一节的 `mcp.gpt-img2.command` 数组和 `environment` 字段。

### 必填环境变量

| 环境变量 | 说明 |
| --- | --- |
| `GPT_IMG2_BASE_URL` | CPA / OpenAI-compatible API base URL，例如 `https://your-domain/v1` |

### 可选环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GPT_IMG2_API_KEY` | 空 | 下游 API key；为空则不发送 `Authorization` header |
| `GPT_IMG2_MODEL` | `gpt-image-2` | 图片模型 |
| `GPT_IMG2_SIZE` | `1024x1024` | 图片尺寸 |
| `GPT_IMG2_QUALITY` | `high` | 图片质量 |
| `GPT_IMG2_OUTPUT_FORMAT` | `png` | 输出格式，例如 `png`、`webp`、`jpeg` |
| `GPT_IMG2_RESPONSE_FORMAT` | `b64_json` | 响应格式，支持 `b64_json` 或 data URL 风格的 `url` |
| `GPT_IMG2_STREAM` | `true` | 是否默认使用流式请求（SSE） |
| `GPT_IMG2_OUTPUT_DIR` | MCP 当前工作目录 | 图片保存目录 |
| `GPT_IMG2_BACKGROUND` | 空 | 可选背景参数 |
| `GPT_IMG2_MODERATION` | 空 | 可选审核参数 |
| `GPT_IMG2_OUTPUT_COMPRESSION` | 空 | 可选压缩参数，数字 |
| `GPT_IMG2_PARTIAL_IMAGES` | 空 | 可选中间图片数量，数字 |
| `GPT_IMG2_USER_AGENT` | `gpt-img2-mcp/0.1.0` | 请求上游时使用的 User-Agent |

`GPT_IMG2_STREAM` 默认值是 `true`。可识别值如下：

- 视为 `true`：`true`、`1`、`yes`、`on`
- 视为 `false`：`false`、`0`、`no`、`off`

当设置为 `false` 时，MCP 将回退到非流式 JSON 请求。

---

## 在 OpenCode 中调用 MCP 工具

配置完成后，OpenCode 会发现 MCP 工具：

```text
generate_image
generate_image_with_size
edit_image
edit_image_with_size
```

### 1. 默认尺寸生图：`generate_image`

调用原有工具时只需要传入：

```json
{
  "prompt": "一张抖音主页面图片"
}
```

这个工具不会固定 prompt，`prompt` 始终来自本次工具调用参数。

### 2. 指定尺寸生图：`generate_image_with_size`

如果要为本次请求指定尺寸，调用新增工具：

```json
{
  "prompt": "一张抖音主页面图片",
  "size": "1536x1024"
}
```

`size` 只影响本次请求，不会修改 `opencode.jsonc` 中的 `GPT_IMG2_SIZE`。

### 3. 默认尺寸编辑：`edit_image`

编辑工具传入 `prompt` + `image_url`。`image_url` 可以是 HTTPS，也可以是 data URL。

HTTPS 示例：

```json
{
  "prompt": "把画面改成夜景，增强霓虹灯反射",
  "image_url": "https://example.com/source.png"
}
```

data URL 示例：

```json
{
  "prompt": "保留人物姿态，替换成赛博朋克背景",
  "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### 4. 指定尺寸编辑：`edit_image_with_size`

如果本次编辑需要覆盖尺寸，使用：

```json
{
  "prompt": "把背景改成雪山日出，整体更通透",
  "image_url": "https://example.com/source.png",
  "size": "1536x1024"
}
```

返回结果是文本 JSON，包含图片保存位置等信息，例如：

```json
{
  "ok": true,
  "operation": "edit",
  "streamed": true,
  "partialImageCount": 2,
  "path": "/absolute/path/to/save/images/gpt-image-edit-20260426-123456-abc123.png",
  "fileName": "gpt-image-edit-20260426-123456-abc123.png",
  "bytes": 956939,
  "mimeType": "image/png",
  "model": "gpt-image-2",
  "size": "1024x1024",
  "quality": "high",
  "outputFormat": "png"
}
```

其中：

- `operation`：`generation` 或 `edit`
- `streamed`：本次是否使用流式请求
- `partialImageCount`：流式过程中收到的 partial image 事件数量（不会保存为本地文件）

---

## OpenCode Slash Commands（重点）

本项目提供 3 个项目级 OpenCode 命令文件：

```text
.opencode/commands/imggeneration.md
.opencode/commands/imggeneration-small.md
.opencode/commands/imggeneration-large.md
```

把这些文件放在你的项目 `.opencode/commands/` 目录后，可以直接在 OpenCode TUI 中输入：

```text
/imggeneration 一张抖音主页面图片
/imggeneration-small 一张抖音主页面图片
/imggeneration-large 一张抖音主页面图片
```

三个命令的行为：

| 命令 | MCP 工具 | 尺寸来源 | prompt 来源 |
| --- | --- | --- | --- |
| `/imggeneration <提示词>` | `generate_image` | `GPT_IMG2_SIZE` | `$ARGUMENTS` |
| `/imggeneration-small <提示词>` | `generate_image_with_size` | 固定 `1024x1024` | `$ARGUMENTS` |
| `/imggeneration-large <提示词>` | `generate_image_with_size` | 固定 `1536x1024` | `$ARGUMENTS` |

> **重点：三个命令都不会固定 prompt。**
>
> 用户在命令后输入的完整内容会作为 `$ARGUMENTS` 传给 MCP 工具的 `prompt` 参数。

命令文件内容也可以手动写入 OpenCode config 的 `command` 配置，但推荐直接使用 `.opencode/commands/*.md`，因为更容易维护和复制。

---

## CPA / CLIProxyAPI 注意事项

CPA 对 `gpt-image-2` 的调用应走 Images API：

```text
POST /v1/images/generations
POST /v1/images/edits
```

不要把 `gpt-image-2` 当普通聊天模型直接用于：

- `/v1/chat/completions`
- `/v1/responses`
- `/v1/messages`

本 MCP 内部调用：

```text
${GPT_IMG2_BASE_URL}/images/generations
${GPT_IMG2_BASE_URL}/images/edits
```

生图请求体会自动加入：

```json
{
  "model": "gpt-image-2",
  "prompt": "...",
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "response_format": "b64_json",
  "stream": true
}
```

编辑请求体会自动加入：

```json
{
  "model": "gpt-image-2",
  "prompt": "...",
  "images": [
    {
      "image_url": "https://example.com/source.png"
    }
  ],
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "response_format": "b64_json",
  "stream": true
}
```

本轻量 MCP 仅支持 JSON `image_url` 编辑链路，不支持 multipart 文件上传与 mask 参数。

其中：

- `generate_image` 的 `size` 来自环境变量
- `generate_image_with_size` 的 `size` 来自本次工具调用参数
- `edit_image` 的 `size` 来自环境变量
- `edit_image_with_size` 的 `size` 来自本次工具调用参数

当 `GPT_IMG2_STREAM=false` 时，上述请求中的 `stream` 会关闭，改走非流式 JSON 返回。

---

## 直接链路测试命令

如果你想绕过 MCP，直接测试 CPA Images API，可以使用：

```bash
curl -sS -X POST "https://your-cpa-domain.example/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  --data '{
    "model": "gpt-image-2",
    "prompt": "一张抖音主页面图片",
    "size": "1024x1024",
    "quality": "high",
    "output_format": "png",
    "response_format": "b64_json"
  }' \
| jq -r '.data[0].b64_json' \
| base64 -d > out.png
```

---

## 本项目文件说明

```text
src/config.js       # 读取 env，构造 Images API 请求参数
src/imageClient.js  # 请求 CPA，处理流式/非流式生图与编辑，解析并保存最终图片
src/server.js       # stdio MCP server，注册 4 个 MCP 工具（生图 + 编辑）
.opencode/commands/ # OpenCode slash commands：/imggeneration、/imggeneration-small、/imggeneration-large
test/               # Node.js 内置 test runner 测试
```

---

## 开发自检

运行全部测试：

```bash
npm test
```

检查语法：

```bash
node --check src/config.js
node --check src/imageClient.js
node --check src/server.js
```

---

## 安全建议

- 不要把真实 API key 写进仓库。
- 建议只在本机私有 `opencode.jsonc` 中配置 key。
- 如果测试 key 临时暴露，测试后应立即删除或轮换。
- README 示例中只使用占位符，不包含真实 key。
