import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { editImage, generateImage } from '../src/imageClient.js';

function createSseResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

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
      stream: true,
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

test('generateImage streaming generation parses partial events and saves completed b64_json image', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const calls = [];
  const partialBytes = Buffer.from('partial bytes');
  const expectedBytes = Buffer.from('stream final png bytes');

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return createSseResponse([
      ': keep-alive\n\n',
      'event: image_generation.partial_image\n',
      `data: ${JSON.stringify({ b64_json: partialBytes.toString('base64') })}\n\n`,
      'event: unknown.event\n',
      'data: {"ignored":true}\n\n',
      'event: image_generation.partial_image\n',
      'data: {"step":2}\n\n',
      'event: image_generation.completed\n',
      `data: ${JSON.stringify({
        b64_json: expectedBytes.toString('base64'),
        revised_prompt: 'stream revised prompt',
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
      })}\n\n`,
    ]);
  };

  try {
    const result = await generateImage({
      prompt: '流式生成图片',
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
        stream: true,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'stream1',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/images/generations');
    assert.equal(JSON.parse(calls[0].options.body).stream, true);
    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 2);
    assert.equal(result.operation, 'generation');
    assert.equal(result.revisedPrompt, 'stream revised prompt');
    assert.equal(result.fileName, 'gpt-image-20260427-000000-stream1.png');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming generation accepts completed data URL payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('stream webp bytes');

  const fetchImpl = async () =>
    createSseResponse([
      'event: image_generation.completed\n',
      `data: ${JSON.stringify({
        data: [
          {
            url: `data:image/webp;base64,${expectedBytes.toString('base64')}`,
            revised_prompt: 'stream url prompt',
          },
        ],
        output_format: 'webp',
      })}\n\n`,
    ]);

  try {
    const result = await generateImage({
      prompt: '流式 data url',
      config: {
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'webp',
        responseFormat: 'url',
        outputDir: tempDir,
        userAgent: 'test-agent',
        stream: true,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'stream2',
    });

    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 0);
    assert.equal(result.operation, 'generation');
    assert.equal(result.fileName, 'gpt-image-20260427-000000-stream2.webp');
    assert.equal(result.mimeType, 'image/webp');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming generation accepts completed b64_json payload larger than 1 MiB', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.alloc(Math.floor(1.2 * 1024 * 1024), 0x5a);

  const fetchImpl = async () =>
    createSseResponse([
      'event: image_generation.completed\n',
      `data: ${JSON.stringify({ b64_json: expectedBytes.toString('base64'), output_format: 'png' })}\n\n`,
    ]);

  try {
    const result = await generateImage({
      prompt: '大图流式完成',
      config: {
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
        outputDir: tempDir,
        userAgent: 'test-agent',
        stream: true,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'stream-large',
    });

    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 0);
    assert.equal(result.bytes, expectedBytes.length);
    const saved = await readFile(result.path);
    assert.equal(saved.length, expectedBytes.length);
    assert.deepEqual(saved.subarray(0, 64), expectedBytes.subarray(0, 64));
    assert.deepEqual(saved.subarray(saved.length - 64), expectedBytes.subarray(expectedBytes.length - 64));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming ignores unknown event with non-JSON data before completed image', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('unknown event ignored bytes');

  const fetchImpl = async () =>
    createSseResponse([
      'event: unknown.event\n',
      'data: not valid json\n\n',
      'event: image_generation.completed\n',
      `data: ${JSON.stringify({ b64_json: expectedBytes.toString('base64'), output_format: 'png' })}\n\n`,
    ]);

  try {
    const result = await generateImage({
      prompt: '未知事件忽略',
      config: {
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
        outputDir: tempDir,
        userAgent: 'test-agent',
        stream: true,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'stream3',
    });

    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 0);
    assert.equal(result.operation, 'generation');
    assert.equal(result.fileName, 'gpt-image-20260427-000000-stream3.png');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming returns after completed event without waiting for later chunks and cancels reader', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('early completion bytes');
  const encoder = new TextEncoder();
  let cancelCalled = false;
  let lateChunkTimer;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: image_generation.completed\ndata: ${JSON.stringify({ b64_json: expectedBytes.toString('base64') })}\n\n`,
        ),
      );

      lateChunkTimer = setTimeout(() => {
        controller.enqueue(encoder.encode('event: image_generation.partial_image\ndata: {"progress":0.9}\n\n'));
        controller.close();
      }, 120);
    },
    cancel() {
      cancelCalled = true;
      if (lateChunkTimer) {
        clearTimeout(lateChunkTimer);
      }
    },
  });

  let timeoutId;
  try {
    const result = await Promise.race([
      generateImage({
        prompt: '提前完成',
        config: {
          baseUrl: 'https://api.example.test/v1',
          model: 'gpt-image-2',
          size: '1024x1024',
          quality: 'high',
          outputFormat: 'png',
          responseFormat: 'b64_json',
          outputDir: tempDir,
          userAgent: 'test-agent',
          stream: true,
        },
        fetchImpl: async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        now: () => new Date('2026-04-27T00:00:00.000Z'),
        randomId: () => 'stream4',
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('timed out waiting for early stream completion'));
        }, 70);
      }),
    ]);

    assert.equal(result.fileName, 'gpt-image-20260427-000000-stream4.png');
    assert.equal(cancelCalled, true);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (lateChunkTimer) {
      clearTimeout(lateChunkTimer);
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming rejects when SSE event buffer exceeds maximum size', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const encoder = new TextEncoder();
  const chunk = encoder.encode('x'.repeat(1024 * 1024));
  const prefix = encoder.encode('event: image_generation.partial_image\ndata: ');

  try {
    await assert.rejects(
      () =>
        generateImage({
          prompt: '超大 SSE 块',
          config: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            responseFormat: 'b64_json',
            outputDir: tempDir,
            userAgent: 'test-agent',
            stream: true,
          },
          fetchImpl: async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(prefix);
                },
                pull(controller) {
                  controller.enqueue(chunk);
                },
              }),
              {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
              },
            ),
        }),
      /maximum SSE event buffer size/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming surfaces upstream error event details', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));

  try {
    await assert.rejects(
      () =>
        generateImage({
          prompt: '上游错误',
          config: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            responseFormat: 'b64_json',
            outputDir: tempDir,
            userAgent: 'test-agent',
            stream: true,
          },
          fetchImpl: async () =>
            createSseResponse([
              'event: error\n',
              `data: ${JSON.stringify({ error: { message: 'quota exceeded', type: 'rate_limit' } })}\n\n`,
            ]),
        }),
      (error) => {
        assert.match(error.message, /quota exceeded/);
        assert.match(error.message, /rate_limit/);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming rejects with clear error when error event JSON is invalid', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));

  try {
    await assert.rejects(
      () =>
        generateImage({
          prompt: '错误事件 JSON 非法',
          config: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            responseFormat: 'b64_json',
            outputDir: tempDir,
            userAgent: 'test-agent',
            stream: true,
          },
          fetchImpl: async () => createSseResponse(['event: error\n', 'data: not-json\n\n']),
        }),
      /invalid JSON.*event "error"/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage streaming generation rejects when no completed image event is received', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));

  try {
    await assert.rejects(
      () =>
        generateImage({
          prompt: '流式无完成事件',
          config: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            responseFormat: 'b64_json',
            outputDir: tempDir,
            userAgent: 'test-agent',
            stream: true,
          },
          fetchImpl: async () =>
            createSseResponse([
              ': heartbeat\n\n',
              'event: image_generation.partial_image\n',
              'data: {"progress":0.5}\n\n',
            ]),
        }),
      /no completed image/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage JSON fallback with stream false saves image and reports non-streamed metadata', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const calls = [];
  const expectedBytes = Buffer.from('json fallback bytes');
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        data: [{ b64_json: expectedBytes.toString('base64') }],
        output_format: 'png',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const result = await generateImage({
      prompt: '非流式 fallback',
      config: {
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
        outputDir: tempDir,
        userAgent: 'test-agent',
        stream: false,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'jsonfb',
    });

    assert.equal(JSON.parse(calls[0].options.body).stream, undefined);
    assert.equal(result.streamed, false);
    assert.equal(result.partialImageCount, 0);
    assert.equal(result.operation, 'generation');
    assert.equal(result.fileName, 'gpt-image-20260427-000000-jsonfb.png');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editImage streaming edit posts edit request and saves completed image', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const calls = [];
  const expectedBytes = Buffer.from('edit stream final png bytes');

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return createSseResponse([
      'event: image_edit.partial_image\n',
      'data: {"progress":0.5}\n\n',
      'event: image_edit.completed\n',
      `data: ${JSON.stringify({
        b64_json: expectedBytes.toString('base64'),
        revised_prompt: 'edit stream revised prompt',
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
      })}\n\n`,
    ]);
  };

  try {
    const result = await editImage({
      prompt: '流式编辑图片',
      imageUrl: 'https://cdn.example.test/input.png',
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
        stream: true,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'edit1',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/images/edits');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
    assert.equal(calls[0].options.headers['User-Agent'], 'test-agent');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      model: 'gpt-image-2',
      prompt: '流式编辑图片',
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      response_format: 'b64_json',
      stream: true,
      images: [{ image_url: 'https://cdn.example.test/input.png' }],
    });

    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 1);
    assert.equal(result.operation, 'edit');
    assert.equal(result.revisedPrompt, 'edit stream revised prompt');
    assert.equal(result.fileName, 'gpt-image-edit-20260427-000000-edit1.png');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editImage JSON fallback with stream false saves image and reports non-streamed metadata', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const calls = [];
  const expectedBytes = Buffer.from('edit json fallback bytes');
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        data: [{ b64_json: expectedBytes.toString('base64') }],
        output_format: 'png',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const result = await editImage({
      prompt: '非流式编辑 fallback',
      imageUrl: 'https://cdn.example.test/input.png',
      config: {
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
        outputDir: tempDir,
        userAgent: 'test-agent',
        stream: false,
      },
      fetchImpl,
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      randomId: () => 'editjson',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/images/edits');
    assert.equal(JSON.parse(calls[0].options.body).stream, undefined);
    assert.deepEqual(JSON.parse(calls[0].options.body).images, [{ image_url: 'https://cdn.example.test/input.png' }]);
    assert.equal(result.streamed, false);
    assert.equal(result.partialImageCount, 0);
    assert.equal(result.operation, 'edit');
    assert.equal(result.fileName, 'gpt-image-edit-20260427-000000-editjson.png');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editImage rejects blank imageUrl before making network request', async () => {
  let called = false;

  await assert.rejects(
    () =>
      editImage({
        prompt: '编辑图片',
        imageUrl: '   ',
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
    /image_url must be a non-empty string/,
  );

  assert.equal(called, false);
});

test('editImage streaming edit rejects when no completed image event is received', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));

  try {
    await assert.rejects(
      () =>
        editImage({
          prompt: '流式编辑无完成事件',
          imageUrl: 'https://cdn.example.test/input.png',
          config: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt-image-2',
            size: '1024x1024',
            quality: 'high',
            outputFormat: 'png',
            responseFormat: 'b64_json',
            outputDir: tempDir,
            userAgent: 'test-agent',
            stream: true,
          },
          fetchImpl: async () =>
            createSseResponse([
              ': heartbeat\n\n',
              'event: image_edit.partial_image\n',
              'data: {"progress":0.5}\n\n',
            ]),
        }),
      /no completed image/i,
    );
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
