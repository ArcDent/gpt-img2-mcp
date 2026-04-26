import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequestOptions, loadConfig, withSizeOverride } from '../src/config.js';

test('loadConfig applies lightweight image defaults from minimal environment', () => {
  const config = loadConfig({
    GPT_IMG2_BASE_URL: 'https://api.example.test/v1',
    GPT_IMG2_API_KEY: 'test-key',
  });

  assert.equal(config.baseUrl, 'https://api.example.test/v1');
  assert.equal(config.apiKey, 'test-key');
  assert.equal(config.model, 'gpt-image-2');
  assert.equal(config.size, '1024x1024');
  assert.equal(config.quality, 'high');
  assert.equal(config.outputFormat, 'png');
  assert.equal(config.responseFormat, 'b64_json');
  assert.equal(config.outputDir, process.cwd());
  assert.equal(config.userAgent, 'gpt-img2-mcp/0.1.0');
});

test('loadConfig parses optional numeric and string image parameters', () => {
  const config = loadConfig({
    GPT_IMG2_BASE_URL: 'https://api.example.test/v1/',
    GPT_IMG2_API_KEY: 'test-key',
    GPT_IMG2_BACKGROUND: 'auto',
    GPT_IMG2_MODERATION: 'auto',
    GPT_IMG2_OUTPUT_COMPRESSION: '88',
    GPT_IMG2_PARTIAL_IMAGES: '2',
    GPT_IMG2_OUTPUT_DIR: '/tmp/images',
    GPT_IMG2_USER_AGENT: 'custom-agent',
  });

  assert.equal(config.baseUrl, 'https://api.example.test/v1');
  assert.equal(config.background, 'auto');
  assert.equal(config.moderation, 'auto');
  assert.equal(config.outputCompression, 88);
  assert.equal(config.partialImages, 2);
  assert.equal(config.outputDir, '/tmp/images');
  assert.equal(config.userAgent, 'custom-agent');
});

test('loadConfig rejects missing required base URL', () => {
  assert.throws(
    () => loadConfig({ GPT_IMG2_API_KEY: 'test-key' }),
    /GPT_IMG2_BASE_URL is required/,
  );
});

test('loadConfig rejects invalid numeric parameters', () => {
  assert.throws(
    () =>
      loadConfig({
        GPT_IMG2_BASE_URL: 'https://api.example.test/v1',
        GPT_IMG2_OUTPUT_COMPRESSION: 'not-a-number',
      }),
    /GPT_IMG2_OUTPUT_COMPRESSION must be a number/,
  );
});

test('buildRequestOptions omits authorization header when API key is not configured', () => {
  const config = loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1' });
  const options = buildRequestOptions(config, '一张图');

  assert.equal(options.url, 'https://api.example.test/v1/images/generations');
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers['User-Agent'], 'gpt-img2-mcp/0.1.0');
  assert.deepEqual(options.body, {
    model: 'gpt-image-2',
    prompt: '一张图',
    size: '1024x1024',
    quality: 'high',
    output_format: 'png',
    response_format: 'b64_json',
  });
});

test('buildRequestOptions includes configured optional image parameters', () => {
  const config = loadConfig({
    GPT_IMG2_BASE_URL: 'https://api.example.test/v1',
    GPT_IMG2_API_KEY: 'test-key',
    GPT_IMG2_MODEL: 'custom-image-model',
    GPT_IMG2_SIZE: '1536x1024',
    GPT_IMG2_QUALITY: 'medium',
    GPT_IMG2_OUTPUT_FORMAT: 'webp',
    GPT_IMG2_RESPONSE_FORMAT: 'url',
    GPT_IMG2_BACKGROUND: 'transparent',
    GPT_IMG2_MODERATION: 'low',
    GPT_IMG2_OUTPUT_COMPRESSION: '75',
    GPT_IMG2_PARTIAL_IMAGES: '1',
  });
  const options = buildRequestOptions(config, '测试提示词');

  assert.equal(options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(options.body, {
    model: 'custom-image-model',
    prompt: '测试提示词',
    size: '1536x1024',
    quality: 'medium',
    output_format: 'webp',
    response_format: 'url',
    background: 'transparent',
    moderation: 'low',
    output_compression: 75,
    partial_images: 1,
  });
});

test('withSizeOverride returns a request-local config copy without mutating the original', () => {
  const config = loadConfig({
    GPT_IMG2_BASE_URL: 'https://api.example.test/v1',
    GPT_IMG2_SIZE: '1024x1024',
  });

  const overridden = withSizeOverride(config, '1536x1024');

  assert.equal(config.size, '1024x1024');
  assert.equal(overridden.size, '1536x1024');
  assert.notEqual(overridden, config);
});
