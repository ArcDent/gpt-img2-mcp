# CLIProxyAPI / CPA 调用 `gpt-image-2` 生图指南

> 本文整理已查询到的 CLIProxyAPI（简称 CPA）对 `gpt-image-2` 图片模型的支持情况，并给出可直接使用的调用示例。
>
> 参考：
> - <https://github.com/router-for-me/CLIProxyAPI>
> - <https://help.router-for.me/introduction/quick-start>

---

## 重点结论

> **重点 1：CPA 已经内置支持 `gpt-image-2`。**
>
> 代码中将 `gpt-image-2` 注册为 Codex 内置图片模型，显示名为 `GPT Image 2`。

> **重点 2：`gpt-image-2` 只能通过 Images API 调用。**
>
> 正确接口：
>
> - `POST /v1/images/generations`
> - `POST /v1/images/edits`
>
> 错误用法：不要直接在 `/v1/chat/completions`、`/v1/responses`、`/v1/messages` 中使用 `model: "gpt-image-2"`。

> **重点 3：CPA 外部表现为 OpenAI Images API，内部通过 Responses + image_generation tool 实现。**
>
> CPA 图片接口内部默认使用：
>
> - 主模型：`gpt-5.4-mini`
> - 图片工具模型：`gpt-image-2`

> **重点 4：可能需要有权限的 Codex / OpenAI 账号。**
>
> CPA 图片生成逻辑会跳过已知 free-tier auth，因此免费账号可能不可用。建议使用有图片生成权限的账号或可用的上游 key。

---

## 一、CPA 对 `gpt-image-2` 的支持情况

### 1. 模型注册

在 CLIProxyAPI 代码中，`gpt-image-2` 被定义为 Codex 内置图片模型：

```go
const codexBuiltinImageModelID = "gpt-image-2"
```

该模型会被注入到 Codex 各个计划层级的模型列表中，包括：

- Free
- Team
- Plus
- Pro

模型元信息大致为：

```json
{
  "id": "gpt-image-2",
  "object": "model",
  "owned_by": "openai",
  "type": "openai",
  "display_name": "GPT Image 2",
  "version": "gpt-image-2"
}
```

### 2. 路由限制

CPA 明确限制 `gpt-image-2` 只能用于图片接口。

如果你在普通文本接口中直接调用：

```json
{
  "model": "gpt-image-2"
}
```

例如调用：

- `/v1/chat/completions`
- `/v1/responses`
- `/v1/messages`

CPA 会返回类似错误：

```text
model gpt-image-2 is only supported on /v1/images/generations and /v1/images/edits
```

> **重点：即使 `/v1/models` 中能看到 `gpt-image-2`，也不代表它能作为普通 chat / responses 模型直接调用。它是图片接口专用模型。**

---

## 二、启动 CPA

CPA 默认服务端口：

```text
8317
```

本地 API Base：

```text
http://127.0.0.1:8317/v1
```

### 1. macOS 安装

```bash
brew install cliproxyapi
brew services start cliproxyapi
```

Homebrew 默认配置文件通常在：

```bash
$(brew --prefix)/etc/cliproxyapi.conf
```

也可以软链到：

```bash
~/.cli-proxy-api/config.yaml
```

### 2. Linux 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/brokechubb/cliproxyapi-installer/refs/heads/master/cliproxyapi-installer | bash
```

### 3. Arch Linux

```bash
yay -S cli-proxy-api-bin
```

或：

```bash
paru -S cli-proxy-api-bin
```

安装后可使用 systemd user service：

```bash
systemctl --user start cli-proxy-api
```

### 4. Docker

```bash
docker run --rm \
  -p 8317:8317 \
  -v /path/to/your/config.yaml:/CLIProxyAPI/config.yaml \
  -v /path/to/your/auth-dir:/root/.cli-proxy-api \
  eceasy/cli-proxy-api:latest
```

### 5. 源码构建

```bash
git clone https://github.com/router-for-me/CLIProxyAPI
cd CLIProxyAPI
go build -o cli-proxy-api ./cmd/server
```

---

## 三、配置与登录

### 1. 基础配置

示例 `config.yaml`：

```yaml
host: ""
port: 8317
auth-dir: "~/.cli-proxy-api"

# 可选：给下游客户端调用 CPA 时使用
api-keys:
  - "your-cpa-api-key"
```

如果配置了 `api-keys`，调用 CPA 时需要携带：

```http
Authorization: Bearer your-cpa-api-key
```

如果没有配置 `api-keys`，本地调用是否需要 key 取决于你的 CPA 配置。

### 2. Codex OAuth 登录

```bash
./cli-proxy-api --codex-login
```

无浏览器环境：

```bash
./cli-proxy-api --codex-login --no-browser
```

OAuth 本地回调端口：

```text
1455
```

登录后启动 CPA：

```bash
./cli-proxy-api
```

### 3. 使用 API Key / 自定义 Codex 兼容上游

CPA 也支持配置 `codex-api-key` 条目，用于 API key 或自定义 Codex 兼容端点。

常见字段包括：

- `api-key`
- `base-url`
- `prefix`
- `headers`
- `proxy-url`
- `models`
- `excluded-models`

> **重点：如果走自定义上游，需要确保该上游同时支持 CPA 图片接口内部需要的 `gpt-5.4-mini` 主模型和 `gpt-image-2` 图片工具能力。**

---

## 四、文生图：`/v1/images/generations`

接口：

```text
POST http://127.0.0.1:8317/v1/images/generations
```

### 1. 最小请求

`model` 可省略，CPA 图片生成接口默认使用 `gpt-image-2`。

```bash
curl http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d '{
    "prompt": "一只穿着宇航服的橘猫，站在月球表面，背后是地球，电影感，高细节"
  }'
```

### 2. 推荐完整请求

```bash
curl http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只穿着宇航服的橘猫，站在月球表面，背后是地球，电影感，高细节",
    "size": "1024x1024",
    "quality": "high",
    "output_format": "png",
    "response_format": "b64_json"
  }'
```

### 3. 保存返回图片

非流式接口默认返回 OpenAI Images 风格 JSON：

```json
{
  "created": 1234567890,
  "data": [
    {
      "b64_json": "..."
    }
  ]
}
```

保存为本地图片：

```bash
curl -s http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "赛博朋克风格的上海夜景，霓虹灯，雨夜，电影海报感",
    "size": "1024x1024",
    "quality": "high",
    "output_format": "png",
    "response_format": "b64_json"
  }' \
| jq -r '.data[0].b64_json' \
| base64 -d > out.png
```

> **重点：如果你的 CPA 没有配置 `api-keys`，可以去掉 `Authorization` 请求头。**

---

## 五、`response_format` 说明

CPA 支持：

```json
{
  "response_format": "b64_json"
}
```

也支持：

```json
{
  "response_format": "url"
}
```

但需要注意：

> **重点：`response_format: "url"` 返回的是 data URL，不是公网托管图片 URL。**

返回值类似：

```text
data:image/png;base64,...
```

示例：

```bash
curl http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一个极简主义 logo，主题是 AI 图像生成",
    "response_format": "url"
  }'
```

---

## 六、流式生图

CPA 图片生成支持 SSE 流式输出。

```bash
curl -N http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一座漂浮在云海之上的未来城市，清晨阳光，超现实主义",
    "size": "1024x1024",
    "quality": "high",
    "output_format": "png",
    "response_format": "b64_json",
    "stream": true,
    "partial_images": 3
  }'
```

可能收到的事件：

```text
event: image_generation.partial_image
data: {...}

event: image_generation.completed
data: {...}
```

说明：

- `image_generation.partial_image`：中间图片结果
- `image_generation.completed`：最终图片结果

---

## 七、图生图 / 图片编辑：`/v1/images/edits`

接口：

```text
POST http://127.0.0.1:8317/v1/images/edits
```

### 1. multipart 上传图片

```bash
curl http://127.0.0.1:8317/v1/images/edits \
  -H "Authorization: Bearer your-cpa-api-key" \
  -F "model=gpt-image-2" \
  -F "prompt=把这张图改成宫崎骏动画风格，保留主体姿势和构图" \
  -F "image=@input.png" \
  -F "size=1024x1024" \
  -F "quality=high" \
  -F "output_format=png" \
  -F "response_format=b64_json" \
| jq -r '.data[0].b64_json' \
| base64 -d > edited.png
```

图片字段支持：

- `image`
- `image[]`

### 2. multipart + mask

```bash
curl http://127.0.0.1:8317/v1/images/edits \
  -H "Authorization: Bearer your-cpa-api-key" \
  -F "model=gpt-image-2" \
  -F "prompt=只替换 mask 区域，把背景改成雪山" \
  -F "image=@input.png" \
  -F "mask=@mask.png" \
  -F "response_format=b64_json" \
| jq -r '.data[0].b64_json' \
| base64 -d > edited.png
```

### 3. JSON data URL 方式

先把图片转为 base64：

```bash
IMG_BASE64=$(base64 -w 0 input.png)
```

然后调用：

```bash
curl http://127.0.0.1:8317/v1/images/edits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d "{
    \"model\": \"gpt-image-2\",
    \"prompt\": \"把图片中的人物换成赛博朋克风格，保留原构图\",
    \"images\": [
      {
        \"image_url\": \"data:image/png;base64,$IMG_BASE64\"
      }
    ],
    \"size\": \"1024x1024\",
    \"quality\": \"high\",
    \"output_format\": \"png\",
    \"response_format\": \"b64_json\"
  }" \
| jq -r '.data[0].b64_json' \
| base64 -d > edited.png
```

JSON 模式中，mask 可这样传：

```json
{
  "mask": {
    "image_url": "data:image/png;base64,..."
  }
}
```

> **重点：JSON 图片编辑模式支持 `image_url`，不支持 `file_id`。**

---

## 八、支持参数汇总

### 1. `/v1/images/generations`

| 参数 | 说明 |
| --- | --- |
| `model` | 图片模型，默认 `gpt-image-2` |
| `prompt` | 必填，生图提示词 |
| `size` | 图片尺寸，例如 `1024x1024` |
| `quality` | 图片质量，例如 `high` |
| `background` | 背景设置 |
| `output_format` | 输出格式，例如 `png` |
| `output_compression` | 输出压缩参数，数字 |
| `partial_images` | 流式时的中间图片数量，数字 |
| `moderation` | 审核策略 |
| `response_format` | `b64_json` 或 `url` |
| `stream` | 是否启用流式输出 |

示例 JSON：

```json
{
  "model": "gpt-image-2",
  "prompt": "你的生图提示词",
  "size": "1024x1024",
  "quality": "high",
  "background": "auto",
  "output_format": "png",
  "output_compression": 90,
  "partial_images": 3,
  "moderation": "auto",
  "response_format": "b64_json",
  "stream": false
}
```

### 2. `/v1/images/edits`

除上面参数外，编辑接口还支持：

| 参数 | 说明 |
| --- | --- |
| `images` | JSON 模式下的输入图片数组 |
| `image` / `image[]` | multipart 模式下的输入图片文件 |
| `mask` | mask 图片 |
| `input_fidelity` | 输入图像保真度，例如 `high` |

---

## 九、内部实现要点

CPA 的图片接口不是简单把请求转发给一个叫 `gpt-image-2` 的普通模型，而是构造 Responses 请求。

内部默认值：

```text
defaultImagesMainModel = "gpt-5.4-mini"
defaultImagesToolModel = "gpt-image-2"
```

内部 Responses 请求大致包含：

```json
{
  "model": "gpt-5.4-mini",
  "stream": true,
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  },
  "parallel_tool_calls": true,
  "tool_choice": {
    "type": "image_generation"
  },
  "tools": [
    {
      "type": "image_generation",
      "action": "generate",
      "model": "gpt-image-2"
    }
  ]
}
```

> **重点：调用者不需要自己构造 Responses + tools。直接调用 CPA 的 `/v1/images/generations` 或 `/v1/images/edits` 即可。**

---

## 十、常见踩坑

### 1. 把 `gpt-image-2` 当普通聊天模型用

错误：

```bash
curl http://127.0.0.1:8317/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "messages": [{"role": "user", "content": "画一只猫"}]
  }'
```

正确：

```bash
curl http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "画一只猫"
  }'
```

### 2. 以为 `response_format: "url"` 是公网图片地址

实际是：

```text
data:image/png;base64,...
```

### 3. 免费账号可能不能用

CPA 图片逻辑会跳过 free-tier auth，因此需要确认你的 Codex / OpenAI 账号或上游 key 有图像生成权限。

### 4. 上游模型权限不足

由于内部依赖：

- `gpt-5.4-mini`
- `gpt-image-2`

所以只看到 `gpt-image-2` 出现在模型列表里，不一定代表实际能生图成功，还要看账号和上游是否有完整权限。

---

## 十一、最短可用命令

如果 CPA 已启动，且你的下游 key 是 `your-cpa-api-key`，可以直接：

```bash
curl -s http://127.0.0.1:8317/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cpa-api-key" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张电影感的未来城市夜景，霓虹灯，雨夜，高细节",
    "size": "1024x1024",
    "quality": "high",
    "output_format": "png",
    "response_format": "b64_json"
  }' \
| jq -r '.data[0].b64_json' \
| base64 -d > out.png
```

如果没有配置 CPA 下游 API Key，去掉：

```bash
-H "Authorization: Bearer your-cpa-api-key"
```

---

## 十二、一句话总结

> **用 CPA 调 `gpt-image-2` 生图时，不要走 chat / responses；把 CPA 当 OpenAI Images API 用，调用 `/v1/images/generations` 或 `/v1/images/edits` 即可。**
