# Streaming Images and Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image generation use CPA streaming SSE by default and add JSON data-URL based `/v1/images/edits` MCP tools.

**Architecture:** Extend `src/config.js` with operation-aware request building and a `GPT_IMG2_STREAM` boolean. Refactor `src/imageClient.js` around a shared operation runner that can parse either SSE streams or existing JSON responses, then add edit MCP tool schemas/handlers in `src/server.js`. Update README and tests to document and verify streaming and edit behavior.

**Tech Stack:** Node.js >=20 ESM, built-in `fetch`/`Response`/Web Streams, Node `node:test`, `@modelcontextprotocol/sdk`, `zod`.

---

## File Structure

- Modify `src/config.js`: add stream config parsing, `buildImageRequestOptions`, edit endpoint support, and keep `buildRequestOptions` compatibility wrapper.
- Modify `src/imageClient.js`: add SSE parser, shared generation/edit runner, `editImage`, and streaming metadata.
- Modify `src/server.js`: add `edit_image` and `edit_image_with_size` tools and schemas.
- Modify `test/config.test.js`: add request-builder and stream flag tests.
- Modify `test/imageClient.test.js`: add streaming generation/edit tests while preserving JSON fallback tests.
- Modify `test/server.test.js`: add edit tool schema tests.
- Modify `README.md`: document streaming default, `GPT_IMG2_STREAM`, `/images/edits`, edit tool inputs, and partial-image handling.

---

### Task 1: Config Streaming and Operation-Aware Request Builder

**Files:**
- Modify: `test/config.test.js`
- Modify: `src/config.js`

- [ ] **Step 1: Write failing config tests**

Append these tests to `test/config.test.js` and update the import to include `buildImageRequestOptions`:

```js
import { buildImageRequestOptions, buildRequestOptions, loadConfig, withSizeOverride } from '../src/config.js';

test('loadConfig enables streaming image requests by default', () => {
  const config = loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1' });

  assert.equal(config.stream, true);
});

test('loadConfig parses GPT_IMG2_STREAM boolean values', () => {
  assert.equal(
    loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1', GPT_IMG2_STREAM: 'false' }).stream,
    false,
  );
  assert.equal(
    loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1', GPT_IMG2_STREAM: '0' }).stream,
    false,
  );
  assert.equal(
    loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1', GPT_IMG2_STREAM: 'yes' }).stream,
    true,
  );
  assert.throws(
    () => loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1', GPT_IMG2_STREAM: 'maybe' }),
    /GPT_IMG2_STREAM must be a boolean/,
  );
});

test('buildImageRequestOptions builds streaming generation requests by default', () => {
  const config = loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1' });
  const options = buildImageRequestOptions(config, { operation: 'generation', prompt: '测试' });

  assert.equal(options.url, 'https://api.example.test/v1/images/generations');
  assert.equal(options.body.stream, true);
  assert.equal(options.body.prompt, '测试');
});

test('buildImageRequestOptions omits stream field when streaming is disabled', () => {
  const config = loadConfig({
    GPT_IMG2_BASE_URL: 'https://api.example.test/v1',
    GPT_IMG2_STREAM: 'false',
  });
  const options = buildImageRequestOptions(config, { operation: 'generation', prompt: '测试' });

  assert.equal(Object.hasOwn(options.body, 'stream'), false);
});

test('buildImageRequestOptions builds edit requests with image_url', () => {
  const config = loadConfig({ GPT_IMG2_BASE_URL: 'https://api.example.test/v1' });
  const options = buildImageRequestOptions(config, {
    operation: 'edit',
    prompt: '改成赛博朋克风格',
    imageUrl: 'data:image/png;base64,aW1hZ2U=',
  });

  assert.equal(options.url, 'https://api.example.test/v1/images/edits');
  assert.equal(options.body.stream, true);
  assert.deepEqual(options.body.images, [{ image_url: 'data:image/png;base64,aW1hZ2U=' }]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- test/config.test.js
```

Expected: FAIL because `buildImageRequestOptions` is not exported and/or `config.stream` does not exist.

- [ ] **Step 3: Implement minimal config changes**

In `src/config.js`, add `optionalBoolean` after `optionalNumber`:

```js
function optionalBoolean(env, key) {
  const raw = optionalString(env, key);
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`${key} must be a boolean`);
}
```

Add `stream` to the object returned by `loadConfig`:

```js
stream: optionalBoolean(env, 'GPT_IMG2_STREAM') ?? true,
```

Replace `buildRequestOptions` with operation-aware helpers:

```js
function baseImageBody(config, prompt) {
  const body = {
    model: config.model,
    prompt,
    size: config.size,
    quality: config.quality,
    output_format: config.outputFormat,
    response_format: config.responseFormat,
  };

  if (config.stream !== false) {
    body.stream = true;
  }
  if (config.background !== undefined) {
    body.background = config.background;
  }
  if (config.moderation !== undefined) {
    body.moderation = config.moderation;
  }
  if (config.outputCompression !== undefined) {
    body.output_compression = config.outputCompression;
  }
  if (config.partialImages !== undefined) {
    body.partial_images = config.partialImages;
  }

  return body;
}

function requestHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': config.userAgent,
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

export function buildImageRequestOptions(config, { operation, prompt, imageUrl }) {
  if (operation !== 'generation' && operation !== 'edit') {
    throw new Error('operation must be generation or edit');
  }

  const body = baseImageBody(config, prompt);
  if (operation === 'edit') {
    const normalizedImageUrl = String(imageUrl ?? '').trim();
    if (!normalizedImageUrl) {
      throw new Error('image_url must be a non-empty string');
    }
    body.images = [{ image_url: normalizedImageUrl }];
  }

  return {
    url: `${config.baseUrl}/images/${operation === 'edit' ? 'edits' : 'generations'}`,
    headers: requestHeaders(config),
    body,
  };
}

export function buildRequestOptions(config, prompt) {
  return buildImageRequestOptions(config, { operation: 'generation', prompt });
}
```

- [ ] **Step 4: Run config tests to verify GREEN**

Run:

```bash
npm test -- test/config.test.js
```

Expected: PASS for all config tests.

- [ ] **Step 5: Self-check Task 1**

Run:

```bash
node --check src/config.js && npm test -- test/config.test.js
```

Expected: syntax check exits 0 and config tests pass.

---

### Task 2: Streaming Generation Client

**Files:**
- Modify: `test/imageClient.test.js`
- Modify: `src/imageClient.js`

- [ ] **Step 1: Add streaming generation tests**

Update the import in `test/imageClient.test.js` if needed, then append:

```js
function sseResponse(messages) {
  const body = messages
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('generateImage parses streaming partial and completed b64 output', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('stream final png bytes');
  const calls = [];

  try {
    const result = await generateImage({
      prompt: '流式生图',
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
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return sseResponse([
          { event: 'image_generation.partial_image', data: { b64_json: Buffer.from('partial').toString('base64') } },
          {
            event: 'image_generation.completed',
            data: {
              b64_json: expectedBytes.toString('base64'),
              revised_prompt: 'stream revised prompt',
              size: '1024x1024',
              quality: 'high',
              output_format: 'png',
            },
          },
        ]);
      },
      now: () => new Date('2026-04-27T01:02:03.000Z'),
      randomId: () => 'aaa111',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/images/generations');
    assert.equal(JSON.parse(calls[0].options.body).stream, true);
    assert.equal(result.fileName, 'gpt-image-20260427-010203-aaa111.png');
    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 1);
    assert.equal(result.operation, 'generation');
    assert.equal(result.revisedPrompt, 'stream revised prompt');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage parses streaming completed data URL output', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('stream webp bytes');

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
      fetchImpl: async () =>
        sseResponse([
          {
            event: 'image_generation.completed',
            data: { url: `data:image/webp;base64,${expectedBytes.toString('base64')}`, output_format: 'webp' },
          },
        ]),
      now: () => new Date('2026-04-27T01:02:03.000Z'),
      randomId: () => 'bbb222',
    });

    assert.equal(result.fileName, 'gpt-image-20260427-010203-bbb222.webp');
    assert.equal(result.streamed, true);
    assert.equal(result.mimeType, 'image/webp');
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('generateImage rejects when streaming response has no completed image', async () => {
  await assert.rejects(
    () =>
      generateImage({
        prompt: '没有完成事件',
        config: {
          baseUrl: 'https://api.example.test/v1',
          model: 'gpt-image-2',
          size: '1024x1024',
          quality: 'high',
          outputFormat: 'png',
          responseFormat: 'b64_json',
          outputDir: process.cwd(),
          userAgent: 'test-agent',
          stream: true,
        },
        fetchImpl: async () =>
          sseResponse([
            { event: 'image_generation.partial_image', data: { b64_json: Buffer.from('partial').toString('base64') } },
          ]),
      }),
    /Streaming image response ended without a completed image event/,
  );
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- test/imageClient.test.js
```

Expected: FAIL because `generateImage` currently calls `response.json()` on SSE and does not return streaming metadata.

- [ ] **Step 3: Implement streaming parser and shared operation runner**

In `src/imageClient.js`, change the config import:

```js
import { buildImageRequestOptions } from './config.js';
```

Add helpers after `extractImageData`:

```js
function contentType(response) {
  return response.headers?.get?.('content-type')?.toLowerCase() ?? '';
}

function completedEventForOperation(operation) {
  return operation === 'edit' ? 'image_edit.completed' : 'image_generation.completed';
}

function filePrefixForOperation(operation) {
  return operation === 'edit' ? 'gpt-image-edit' : 'gpt-image';
}

function normalizeImagePayload(data) {
  if (data?.data?.[0]) {
    return data;
  }
  if (data && typeof data === 'object' && (typeof data.b64_json === 'string' || typeof data.url === 'string')) {
    return { data: [data], size: data.size, quality: data.quality, output_format: data.output_format };
  }
  return undefined;
}

function parseSseMessage(message) {
  let event = 'message';
  const dataLines = [];
  for (const line of message.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  return { event, data: dataLines.join('\n') };
}

async function parseStreamingImageResponse(response, operation) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('Streaming image response did not include a readable body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let partialImageCount = 0;
  let completedPayload;
  const completedEvent = completedEventForOperation(operation);

  async function consumeMessage(rawMessage) {
    const trimmed = rawMessage.trim();
    if (!trimmed) {
      return;
    }
    const { event, data } = parseSseMessage(trimmed);
    if (event.endsWith('.partial_image')) {
      partialImageCount += 1;
    }
    if (!data || data === '[DONE]') {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (event === completedEvent && completedPayload === undefined) {
      completedPayload = normalizeImagePayload(parsed);
      return;
    }
    if (completedPayload === undefined) {
      completedPayload = normalizeImagePayload(parsed);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split(/\r?\n\r?\n/);
    buffer = messages.pop() ?? '';
    for (const message of messages) {
      await consumeMessage(message);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await consumeMessage(buffer);
  }

  if (!completedPayload) {
    throw new Error('Streaming image response ended without a completed image event');
  }

  return { payload: completedPayload, partialImageCount };
}
```

Replace `generateImage` with a shared runner plus wrapper:

```js
async function runImageOperation({
  operation,
  prompt,
  imageUrl,
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomId = defaultRandomId,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime');
  }

  const normalizedPrompt = normalizePrompt(prompt);
  const request = buildImageRequestOptions(config, { operation, prompt: normalizedPrompt, imageUrl });
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Image ${operation} request failed with HTTP ${response.status}: ${body}`);
  }

  const isStreaming = contentType(response).includes('text/event-stream');
  const streamResult = isStreaming
    ? await parseStreamingImageResponse(response, operation)
    : { payload: await response.json(), partialImageCount: 0 };

  const payload = streamResult.payload;
  const payloadFormat = String(payload.output_format || config.outputFormat || 'png').toLowerCase();
  const fallbackMimeType = MIME_BY_EXTENSION[payloadFormat] ?? 'image/png';
  const image = extractImageData(payload, fallbackMimeType);
  const extension = extensionFromConfig(config, image.mimeType);
  const fileName = `${filePrefixForOperation(operation)}-${timestamp(now())}-${randomId()}.${extension}`;
  const outputPath = path.join(config.outputDir, fileName);

  await mkdir(config.outputDir, { recursive: true });
  await writeFile(outputPath, image.bytes);

  return {
    path: outputPath,
    fileName,
    bytes: image.bytes.length,
    mimeType: image.mimeType,
    revisedPrompt: image.revisedPrompt,
    model: config.model,
    size: payload.size ?? config.size,
    quality: payload.quality ?? config.quality,
    outputFormat: payload.output_format ?? config.outputFormat,
    operation,
    streamed: isStreaming,
    partialImageCount: streamResult.partialImageCount,
  };
}

export async function generateImage(options) {
  return runImageOperation({ ...options, operation: 'generation' });
}
```

- [ ] **Step 4: Run image client tests to verify GREEN for streaming generation**

Run:

```bash
npm test -- test/imageClient.test.js
```

Expected: PASS for existing JSON fallback and new streaming generation tests.

- [ ] **Step 5: Self-check Task 2**

Run:

```bash
node --check src/imageClient.js && npm test -- test/imageClient.test.js
```

Expected: syntax check exits 0 and image client tests pass.

---

### Task 3: Edit Image Client

**Files:**
- Modify: `test/imageClient.test.js`
- Modify: `src/imageClient.js`

- [ ] **Step 1: Add edit client tests**

Update the import in `test/imageClient.test.js`:

```js
import { editImage, generateImage } from '../src/imageClient.js';
```

Append:

```js
test('editImage posts streaming edit request and saves completed output', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gpt-img2-mcp-'));
  const expectedBytes = Buffer.from('edited png bytes');
  const calls = [];

  try {
    const result = await editImage({
      prompt: '把图片改成霓虹风格',
      imageUrl: 'data:image/png;base64,aW5wdXQ=',
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
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return sseResponse([
          { event: 'image_edit.partial_image', data: { b64_json: Buffer.from('partial').toString('base64') } },
          {
            event: 'image_edit.completed',
            data: {
              b64_json: expectedBytes.toString('base64'),
              revised_prompt: 'edited revised prompt',
              output_format: 'png',
            },
          },
        ]);
      },
      now: () => new Date('2026-04-27T04:05:06.000Z'),
      randomId: () => 'ccc333',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.test/v1/images/edits');
    assert.deepEqual(JSON.parse(calls[0].options.body).images, [
      { image_url: 'data:image/png;base64,aW5wdXQ=' },
    ]);
    assert.equal(JSON.parse(calls[0].options.body).stream, true);
    assert.equal(result.fileName, 'gpt-image-edit-20260427-040506-ccc333.png');
    assert.equal(result.operation, 'edit');
    assert.equal(result.streamed, true);
    assert.equal(result.partialImageCount, 1);
    assert.deepEqual(await readFile(result.path), expectedBytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editImage rejects blank image_url before making network request', async () => {
  let called = false;

  await assert.rejects(
    () =>
      editImage({
        prompt: '测试',
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
          stream: true,
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
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- test/imageClient.test.js
```

Expected: FAIL because `editImage` is not exported.

- [ ] **Step 3: Implement editImage export**

At the bottom of `src/imageClient.js`, after `generateImage`, add:

```js
export async function editImage(options) {
  return runImageOperation({ ...options, operation: 'edit' });
}
```

Ensure `buildImageRequestOptions` validates blank `imageUrl` before `fetchImpl` is called.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- test/imageClient.test.js
```

Expected: PASS.

- [ ] **Step 5: Self-check Task 3**

Run:

```bash
node --check src/imageClient.js && npm test -- test/imageClient.test.js
```

Expected: syntax check exits 0 and image client tests pass.

---

### Task 4: MCP Edit Tool Schemas and Handlers

**Files:**
- Modify: `test/server.test.js`
- Modify: `src/server.js`

- [ ] **Step 1: Add server schema tests**

Update the import in `test/server.test.js`:

```js
import {
  editImageJsonSchema,
  editImageWithSizeJsonSchema,
  promptJsonSchema,
  sizePromptJsonSchema,
  TOOL_NAMES,
} from '../src/server.js';
```

Append:

```js
test('MCP server exposes an edit image tool schema', () => {
  assert.equal(TOOL_NAMES.editImage, 'edit_image');
  assert.deepEqual(Object.keys(editImageJsonSchema.properties), ['prompt', 'image_url']);
  assert.deepEqual(editImageJsonSchema.required, ['prompt', 'image_url']);
  assert.equal(editImageJsonSchema.additionalProperties, false);
  assert.equal(editImageJsonSchema.properties.image_url.type, 'string');
  assert.equal(editImageJsonSchema.properties.image_url.minLength, 1);
});

test('MCP server exposes a size-aware edit image tool schema', () => {
  assert.equal(TOOL_NAMES.editImageWithSize, 'edit_image_with_size');
  assert.deepEqual(Object.keys(editImageWithSizeJsonSchema.properties), ['prompt', 'image_url', 'size']);
  assert.deepEqual(editImageWithSizeJsonSchema.required, ['prompt', 'image_url', 'size']);
  assert.equal(editImageWithSizeJsonSchema.additionalProperties, false);
  assert.equal(editImageWithSizeJsonSchema.properties.image_url.type, 'string');
  assert.equal(editImageWithSizeJsonSchema.properties.size.type, 'string');
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- test/server.test.js
```

Expected: FAIL because edit schemas and tool names are not exported.

- [ ] **Step 3: Implement MCP edit schemas and handlers**

In `src/server.js`, change import:

```js
import { editImage, generateImage } from './imageClient.js';
```

Extend `TOOL_NAMES`:

```js
export const TOOL_NAMES = {
  generateImage: 'generate_image',
  generateImageWithSize: 'generate_image_with_size',
  editImage: 'edit_image',
  editImageWithSize: 'edit_image_with_size',
};
```

Add zod schemas:

```js
export const editImageSchema = z
  .object({
    prompt: z.string().min(1).describe('图片编辑提示词。'),
    image_url: z.string().min(1).describe('待编辑图片的 data URL，例如 data:image/png;base64,...。'),
  })
  .strict();

export const editImageWithSizeSchema = z
  .object({
    prompt: z.string().min(1).describe('图片编辑提示词。'),
    image_url: z.string().min(1).describe('待编辑图片的 data URL，例如 data:image/png;base64,...。'),
    size: z.string().min(1).describe('本次编辑输出尺寸，例如 1024x1024 或 1536x1024。'),
  })
  .strict();
```

Add JSON schemas:

```js
export const editImageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'image_url'],
  properties: {
    prompt: { type: 'string', minLength: 1, description: '图片编辑提示词。' },
    image_url: { type: 'string', minLength: 1, description: '待编辑图片的 data URL，例如 data:image/png;base64,...。' },
  },
};

export const editImageWithSizeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'image_url', 'size'],
  properties: {
    prompt: { type: 'string', minLength: 1, description: '图片编辑提示词。' },
    image_url: { type: 'string', minLength: 1, description: '待编辑图片的 data URL，例如 data:image/png;base64,...。' },
    size: { type: 'string', minLength: 1, description: '本次编辑输出尺寸，例如 1024x1024 或 1536x1024。' },
  },
};
```

Update `imageResultContent` JSON to include:

```js
operation: result.operation,
streamed: result.streamed,
partialImageCount: result.partialImageCount,
```

Register `edit_image`:

```js
server.registerTool(
  TOOL_NAMES.editImage,
  {
    title: 'Edit GPT Image 2 Image',
    description: '通过 CPA / OpenAI Images Edits API 编辑图片。入参是 prompt 和 image_url，其余参数由 OpenCode MCP env 配置。',
    inputSchema: editImageSchema,
    annotations: {
      title: 'Edit image from prompt and image data URL',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: { inputSchema: editImageJsonSchema },
  },
  async ({ prompt, image_url }) => {
    const config = loadConfig(env);
    const result = await editImage({ prompt, imageUrl: image_url, config });
    return imageResultContent(result);
  },
);
```

Register `edit_image_with_size`:

```js
server.registerTool(
  TOOL_NAMES.editImageWithSize,
  {
    title: 'Edit GPT Image 2 Image With Size',
    description: '通过 CPA / OpenAI Images Edits API 编辑图片。入参是 prompt、image_url 和本次请求的 size，其余参数由 OpenCode MCP env 配置。',
    inputSchema: editImageWithSizeSchema,
    annotations: {
      title: 'Edit image from prompt, image data URL, and size',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: { inputSchema: editImageWithSizeJsonSchema },
  },
  async ({ prompt, image_url, size }) => {
    const config = withSizeOverride(loadConfig(env), size);
    const result = await editImage({ prompt, imageUrl: image_url, config });
    return imageResultContent(result);
  },
);
```

- [ ] **Step 4: Run server tests to verify GREEN**

Run:

```bash
npm test -- test/server.test.js
```

Expected: PASS.

- [ ] **Step 5: Self-check Task 4**

Run:

```bash
node --check src/server.js && npm test -- test/server.test.js
```

Expected: syntax check exits 0 and server tests pass.

---

### Task 5: README Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README feature summary**

In `README.md`, change the opening tool list to include all four tools:

```text
generate_image
generate_image_with_size
edit_image
edit_image_with_size
```

Add JSON examples for edit tools near the existing generation examples:

```json
{
  "prompt": "把图片改成赛博朋克风格",
  "image_url": "data:image/png;base64,..."
}
```

and:

```json
{
  "prompt": "把图片改成赛博朋克风格",
  "image_url": "data:image/png;base64,...",
  "size": "1536x1024"
}
```

- [ ] **Step 2: Document streaming env and behavior**

In both OpenCode and generic stdio env examples, add:

```jsonc
"GPT_IMG2_STREAM": "true",
```

In the optional env table, add:

```markdown
| `GPT_IMG2_STREAM` | `true` | 是否启用 CPA Images SSE 流式响应；建议保持 `true`，避免长时间生图超时 |
```

Add a section under CPA notes:

```markdown
### 流式响应说明

本 MCP 默认在请求体中加入 `"stream": true`。CPA 会通过 SSE 返回 `image_generation.partial_image` / `image_generation.completed`，编辑接口会返回 `image_edit.partial_image` / `image_edit.completed`。MCP 会消费 partial 事件并统计数量，但只保存 completed 事件中的最终图片。

如果设置 `GPT_IMG2_STREAM=false`，MCP 会退回等待最终 JSON 响应；这可能在 CPA 长时间生图时触发超时，不推荐作为默认配置。
```

- [ ] **Step 3: Document edits endpoint and tools**

Update CPA endpoint documentation to list both:

```text
POST /v1/images/generations
POST /v1/images/edits
```

Add tool usage text:

```markdown
### 3. 编辑图片：`edit_image`

`edit_image` 调用 `/v1/images/edits`。`image_url` 应传入图片 data URL，例如 `data:image/png;base64,...`。

### 4. 指定尺寸编辑图片：`edit_image_with_size`

`edit_image_with_size` 与 `edit_image` 相同，但 `size` 只覆盖本次编辑输出尺寸。
```

Update file descriptions so `src/imageClient.js` says it parses SSE/JSON and supports generation/edit.

- [ ] **Step 4: Self-check README content**

Run:

```bash
grep -n "GPT_IMG2_STREAM\|edit_image\|/images/edits\|image_generation.partial_image\|image_edit.completed" README.md
```

Expected: each searched term appears at least once.

---

### Task 6: Full Verification, Commit, Push, and PR

**Files:**
- All modified files

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass with `# fail 0`.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
node --check src/config.js && node --check src/imageClient.js && node --check src/server.js && node --check test/config.test.js && node --check test/imageClient.test.js && node --check test/server.test.js
```

Expected: no output and exit code 0.

- [ ] **Step 3: Verify branch and diff**

Run:

```bash
git status --short --branch && git diff --stat
```

Expected: branch is `ArcDev`; diff includes source, tests, README, spec, and plan files.

- [ ] **Step 4: Commit changes**

Run:

```bash
git add README.md docs/superpowers/specs/2026-04-27-streaming-images-and-edits-design.md docs/superpowers/plans/2026-04-27-streaming-images-and-edits.md src/config.js src/imageClient.js src/server.js test/config.test.js test/imageClient.test.js test/server.test.js && git commit -m "feat: add streaming image edits support"
```

Expected: commit succeeds on `ArcDev`.

- [ ] **Step 5: Push ArcDev**

Run:

```bash
git push origin ArcDev
```

Expected: `ArcDev` pushes successfully.

- [ ] **Step 6: Update or create PR**

If PR #1 exists, verify it now includes the new commit. If no PR exists, create a PR from `ArcDev` to `main` titled:

```text
feat: add streaming image edits support
```

PR body:

```markdown
## Summary
- Enable CPA Images SSE streaming by default to avoid long image request timeouts.
- Add `/v1/images/edits` support through `edit_image` and `edit_image_with_size` MCP tools.
- Document `GPT_IMG2_STREAM`, streaming event handling, and edit data URL usage.

## Verification
- npm test
- node --check src/config.js src/imageClient.js src/server.js and test files
```

- [ ] **Step 7: Final acceptance self-check**

Run:

```bash
git status --short --branch
```

Expected: `ArcDev` tracks `origin/ArcDev` with no uncommitted changes.

Also verify PR reports head `ArcDev`, base `main`, and mergeable state is not blocked.

---

## Plan Self-Review

- Spec coverage: Tasks cover stream config, generation SSE parsing, edit endpoint client, MCP edit tools, README docs, verification, push, and PR.
- Placeholder scan: no plan step uses open-ended implementation language; code snippets and commands are explicit.
- Type consistency: names are consistent across tasks: `buildImageRequestOptions`, `editImage`, `edit_image`, `edit_image_with_size`, `image_url`, `GPT_IMG2_STREAM`, `partialImageCount`, `streamed`.
- TDD check: Tasks 1-4 require tests to be written and observed failing before implementation.
- Self-check check: every implementation task ends with command-based verification.
