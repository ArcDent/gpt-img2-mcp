---
description: 使用小尺寸生成 GPT Image 2 图片
---

请调用 MCP 工具 `generate_image_with_size` 生成图片。

工具参数必须是：

```json
{
  "prompt": "$ARGUMENTS",
  "size": "1024x1024"
}
```

要求：
- `$ARGUMENTS` 是用户在 `/imggeneration-small` 后输入的完整提示词。
- 不要改写、替换或固定提示词。
- `size` 固定为 `1024x1024`，只影响本次请求。
