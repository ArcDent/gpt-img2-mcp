---
description: 使用默认尺寸生成 GPT Image 2 图片
---

请调用 MCP 工具 `generate_image` 生成图片。

工具参数必须是：

```json
{
  "prompt": "$ARGUMENTS"
}
```

要求：
- `$ARGUMENTS` 是用户在 `/imggeneration` 后输入的完整提示词。
- 不要改写、替换或固定提示词。
- 不要额外传入 `size`；尺寸使用 MCP 环境变量 `GPT_IMG2_SIZE` 的配置。
