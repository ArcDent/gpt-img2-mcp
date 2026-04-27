import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  editPromptJsonSchema,
  editSizePromptJsonSchema,
  imageResultContent,
  promptJsonSchema,
  sizePromptJsonSchema,
  TOOL_NAMES,
} from '../src/server.js';

test('MCP server keeps the original prompt-only image tool schema dynamic', () => {
  assert.equal(TOOL_NAMES.generateImage, 'generate_image');
  assert.deepEqual(Object.keys(promptJsonSchema.properties), ['prompt']);
  assert.deepEqual(promptJsonSchema.required, ['prompt']);
  assert.equal(promptJsonSchema.additionalProperties, false);
  assert.doesNotMatch(promptJsonSchema.properties.prompt.description, /一张抖音主页面图片/);
});

test('MCP server exposes a size-aware image tool schema', () => {
  assert.equal(TOOL_NAMES.generateImageWithSize, 'generate_image_with_size');
  assert.deepEqual(Object.keys(sizePromptJsonSchema.properties), ['prompt', 'size']);
  assert.deepEqual(sizePromptJsonSchema.required, ['prompt', 'size']);
  assert.equal(sizePromptJsonSchema.additionalProperties, false);
  assert.equal(sizePromptJsonSchema.properties.size.type, 'string');
  assert.equal(sizePromptJsonSchema.properties.size.minLength, 1);
});

test('MCP server exposes edit tool names', () => {
  assert.equal(TOOL_NAMES.editImage, 'edit_image');
  assert.equal(TOOL_NAMES.editImageWithSize, 'edit_image_with_size');
});

test('MCP server exposes strict edit prompt schema', () => {
  assert.deepEqual(Object.keys(editPromptJsonSchema.properties), ['prompt', 'image_url']);
  assert.deepEqual(editPromptJsonSchema.required, ['prompt', 'image_url']);
  assert.equal(editPromptJsonSchema.additionalProperties, false);

  assert.equal(editPromptJsonSchema.properties.prompt.type, 'string');
  assert.equal(editPromptJsonSchema.properties.prompt.minLength, 1);
  assert.equal(typeof editPromptJsonSchema.properties.prompt.description, 'string');
  assert.ok(editPromptJsonSchema.properties.prompt.description.length > 0);

  assert.equal(editPromptJsonSchema.properties.image_url.type, 'string');
  assert.equal(editPromptJsonSchema.properties.image_url.minLength, 1);
  assert.equal(typeof editPromptJsonSchema.properties.image_url.description, 'string');
  assert.ok(editPromptJsonSchema.properties.image_url.description.length > 0);
});

test('MCP server exposes strict edit+size prompt schema', () => {
  assert.deepEqual(Object.keys(editSizePromptJsonSchema.properties), ['prompt', 'image_url', 'size']);
  assert.deepEqual(editSizePromptJsonSchema.required, ['prompt', 'image_url', 'size']);
  assert.equal(editSizePromptJsonSchema.additionalProperties, false);

  assert.equal(editSizePromptJsonSchema.properties.prompt.type, 'string');
  assert.equal(editSizePromptJsonSchema.properties.prompt.minLength, 1);

  assert.equal(editSizePromptJsonSchema.properties.image_url.type, 'string');
  assert.equal(editSizePromptJsonSchema.properties.image_url.minLength, 1);

  assert.equal(editSizePromptJsonSchema.properties.size.type, 'string');
  assert.equal(editSizePromptJsonSchema.properties.size.minLength, 1);
});

test('MCP server result content includes operation stream metadata', () => {
  const response = imageResultContent({
    path: '/tmp/image.png',
    fileName: 'image.png',
    bytes: 123,
    mimeType: 'image/png',
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'medium',
    outputFormat: 'png',
    revisedPrompt: 'revised',
    operation: 'edit',
    streamed: true,
    partialImageCount: 2,
  });

  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.operation, 'edit');
  assert.equal(payload.streamed, true);
  assert.equal(payload.partialImageCount, 2);
});
