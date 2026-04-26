#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, withSizeOverride } from './config.js';
import { generateImage } from './imageClient.js';

export const TOOL_NAME = 'generate_image';
export const TOOL_NAMES = {
  generateImage: 'generate_image',
  generateImageWithSize: 'generate_image_with_size',
};

export const promptSchema = z
  .object({
    prompt: z.string().min(1).describe('生图提示词。'),
  })
  .strict();

export const sizePromptSchema = z
  .object({
    prompt: z.string().min(1).describe('生图提示词。'),
    size: z.string().min(1).describe('本次生图尺寸，例如 1024x1024 或 1536x1024。'),
  })
  .strict();

export const promptJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      description: '生图提示词。',
    },
  },
};

export const sizePromptJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'size'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      description: '生图提示词。',
    },
    size: {
      type: 'string',
      minLength: 1,
      description: '本次生图尺寸，例如 1024x1024 或 1536x1024。',
    },
  },
};

function imageResultContent(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: true,
            path: result.path,
            fileName: result.fileName,
            bytes: result.bytes,
            mimeType: result.mimeType,
            model: result.model,
            size: result.size,
            quality: result.quality,
            outputFormat: result.outputFormat,
            revisedPrompt: result.revisedPrompt,
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function createServer({ env = process.env } = {}) {
  const server = new McpServer({
    name: 'gpt-img2-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    TOOL_NAMES.generateImage,
    {
      title: 'Generate GPT Image 2 Image',
      description: '通过 CPA / OpenAI Images API 生成图片。工具入参是 prompt，其余参数由 OpenCode MCP env 配置。',
      inputSchema: promptSchema,
      annotations: {
        title: 'Generate image from prompt',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        inputSchema: promptJsonSchema,
      },
    },
    async ({ prompt }) => {
      const config = loadConfig(env);
      const result = await generateImage({ prompt, config });

      return imageResultContent(result);
    },
  );

  server.registerTool(
    TOOL_NAMES.generateImageWithSize,
    {
      title: 'Generate GPT Image 2 Image With Size',
      description: '通过 CPA / OpenAI Images API 生成图片。工具入参是 prompt 和本次请求的 size，其余参数由 OpenCode MCP env 配置。',
      inputSchema: sizePromptSchema,
      annotations: {
        title: 'Generate image from prompt and size',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        inputSchema: sizePromptJsonSchema,
      },
    },
    async ({ prompt, size }) => {
      const config = withSizeOverride(loadConfig(env), size);
      const result = await generateImage({ prompt, config });

      return imageResultContent(result);
    },
  );

  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
