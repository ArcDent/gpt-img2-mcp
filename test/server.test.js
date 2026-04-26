import assert from 'node:assert/strict';
import { test } from 'node:test';

import { promptJsonSchema, sizePromptJsonSchema, TOOL_NAMES } from '../src/server.js';

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
