#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, withSizeOverride } from './config.js';
import { editImage, generateImage } from './imageClient.js';

export const TOOL_NAME = 'generate_image';
export const TOOL_NAMES = {
  generateImage: 'generate_image',
  generateImageWithSize: 'generate_image_with_size',
  editImage: 'edit_image',
  editImageWithSize: 'edit_image_with_size',
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

export const editPromptSchema = z
  .object({
    prompt: z.string().min(1).describe('图片编辑提示词。'),
    image_url: z.string().min(1).describe('待编辑图片地址。'),
  })
  .strict();

export const editSizePromptSchema = z
  .object({
    prompt: z.string().min(1).describe('图片编辑提示词。'),
    image_url: z.string().min(1).describe('待编辑图片地址。'),
    size: z.string().min(1).describe('本次图片编辑尺寸，例如 1024x1024 或 1536x1024。'),
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

export const editPromptJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'image_url'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      description: '图片编辑提示词。',
    },
    image_url: {
      type: 'string',
      minLength: 1,
      description: '待编辑图片地址。',
    },
  },
};

export const editSizePromptJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'image_url', 'size'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      description: '图片编辑提示词。',
    },
    image_url: {
      type: 'string',
      minLength: 1,
      description: '待编辑图片地址。',
    },
    size: {
      type: 'string',
      minLength: 1,
      description: '本次图片编辑尺寸，例如 1024x1024 或 1536x1024。',
    },
  },
};

export function imageResultContent(result) {
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
            operation: result.operation,
            streamed: result.streamed,
            partialImageCount: result.partialImageCount,
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

  server.registerTool(
    TOOL_NAMES.editImage,
    {
      title: 'Edit GPT Image 2 Image',
      description: '通过 CPA / OpenAI Images API 编辑图片。工具入参是 prompt 和 image_url，其余参数由 OpenCode MCP env 配置。',
      inputSchema: editPromptSchema,
      annotations: {
        title: 'Edit image from prompt and source image',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        inputSchema: editPromptJsonSchema,
      },
    },
    async ({ prompt, image_url }) => {
      const config = loadConfig(env);
      const result = await editImage({ prompt, imageUrl: image_url, config });

      return imageResultContent(result);
    },
  );

  server.registerTool(
    TOOL_NAMES.editImageWithSize,
    {
      title: 'Edit GPT Image 2 Image With Size',
      description:
        '通过 CPA / OpenAI Images API 编辑图片。工具入参是 prompt、image_url 和本次请求的 size，其余参数由 OpenCode MCP env 配置。',
      inputSchema: editSizePromptSchema,
      annotations: {
        title: 'Edit image from prompt source image and size',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        inputSchema: editSizePromptJsonSchema,
      },
    },
    async ({ prompt, image_url, size }) => {
      const config = withSizeOverride(loadConfig(env), size);
      const result = await editImage({ prompt, imageUrl: image_url, config });

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
