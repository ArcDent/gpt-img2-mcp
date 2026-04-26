import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { generateImage } from '../src/imageClient.js';

test('generateImage posts configured image request and saves b64_json output', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const calls = [];
  const expectedBytes = Buffer.from('fake png bytes');
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        created: 1710000000,
        data: [
          {
            b64_json: expectedBytes.toString('base64'),
            revised_prompt: 'revised prompt',
          },
        ],
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  try {
    const result = await generateImage({
      prompt: '一张抖音主页面图片',
      config: {
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'test-key',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
        outputDir: tempDir,
        userAgent: 'test-agent',
      },
      fetchImpl,
      now: () => new Date('2026-04-26T12:34:56.000Z'),
      randomId: () => 'abc123',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/images/generations');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
    assert.equal(calls[0].options.headers['User-Agent'], 'test-agent');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      model: 'gpt-image-2',
      prompt: '一张抖音主页面图片',
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      response_format: 'b64_json',
    });

    assert.equal(result.fileName, 'gpt-image-20260426-123456-abc123.png');
    assert.equal(result.path, path.join(tempDir, 'gpt-image-20260426-123456-abc123.png'));
    assert.equal(result.bytes, expectedBytes.length);
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.revisedPrompt, 'revised prompt');
    assert.deepEqual(await readFile(result.path), expectedBytes);
    assert.equal((await stat(result.path)).size, expectedBytes.length);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage decodes data URL output when response_format is url', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('webp bytes');
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            url: `data:image/webp;base64,${expectedBytes.toString('base64')}`,
          },
        ],
        output_format: 'webp',
      }),
      { status: 200 },
    );

  try {
    const result = await generateImage({
      prompt: '测试',
      config: {
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'webp',
        responseFormat: 'url',
        outputDir: tempDir,
        userAgent: 'test-agent',
      },
      fetchImpl,
      now: () => new Date('2026-04-26T12:34:56.000Z'),
      randomId: () => 'def456',
    });

    assert.equal(result.fileName, 'gpt-image-20260426-123456-def456.webp');
    assert.equal(result.mimeType, 'image/webp');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage rejects empty prompt before making network request', async () => {
  let called = false;

  await assert.rejects(
    () =>
      generateImage({
        prompt: '   ',
        config: {
          baseUrl: 'https://api.example.test/v1',
          model: 'gpt-image-2',
          size: '1024x1024',
          quality: 'high',
          outputFormat: 'png',
          responseFormat: 'b64_json',
          outputDir: process.cwd(),
          userAgent: 'test-agent',
        },
        fetchImpl: async () => {
          called = true;
          return new Response('{}', { status: 200 });
        },
      }),
    /prompt must be a non-empty string/,
  );

  assert.equal(called, false);
});

test('generateImage includes response body when upstream fails', async () => {
  await assert.rejects(
    () =>
      generateImage({
        prompt: '测试',
        config: {
          baseUrl: 'https://api.example.test/v1',
          model: 'gpt-image-2',
          size: '1024x1024',
          quality: 'high',
          outputFormat: 'png',
          responseFormat: 'b64_json',
          outputDir: process.cwd(),
          userAgent: 'test-agent',
        },
        fetchImpl: async () => new Response('bad gateway', { status: 502 }),
      }),
    /Image generation request failed with HTTP 502: bad gateway/,
  );
});
