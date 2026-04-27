import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildImageRequestOptions } from './config.js';

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

const MAX_PENDING_SSE_MESSAGE_BUFFER_BYTES = 64 * 1024 * 1024;

function normalizePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('prompt must be a non-empty string');
  }
  return prompt.trim();
}

function normalizeImageUrl(imageUrl) {
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    throw new Error('image_url must be a non-empty string');
  }
  return imageUrl.trim();
}

function timestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-');
}

function defaultRandomId() {
  return randomBytes(3).toString('hex');
}

function extensionFromConfig(config, mimeType) {
  const configured = String(config.outputFormat || '').toLowerCase().replace(/^jpg$/, 'jpeg');
  if (configured) {
    return configured === 'jpeg' ? 'jpg' : configured;
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  return 'png';
}

function extractImagePayload(payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.b64_json === 'string' || typeof payload.url === 'string') {
      return payload;
    }

    const first = payload?.data?.[0];
    if (first && typeof first === 'object') {
      return first;
    }
  }

  throw new Error('Image generation response did not include data[0]');
}

function extractImageData(payload, fallbackMimeType) {
  const item = extractImagePayload(payload);

  if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
    return {
      bytes: Buffer.from(item.b64_json, 'base64'),
      mimeType: fallbackMimeType,
      revisedPrompt: item.revised_prompt,
    };
  }

  if (typeof item.url === 'string' && item.url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(item.url);
    if (!match) {
      throw new Error('Image generation response included an invalid data URL');
    }
    return {
      bytes: Buffer.from(match[2], 'base64'),
      mimeType: match[1],
      revisedPrompt: item.revised_prompt,
    };
  }

  throw new Error('Image generation response did not include b64_json or data URL');
}

function isStreamingResponse(config, response) {
  if (config.stream === false) {
    return false;
  }

  const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
  return contentType.includes('text/event-stream');
}

function parseSseEventBlock(block) {
  if (!block || block.trim() === '') {
    return null;
  }

  const lines = block.split(/\r?\n/);
  let eventName = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }

    const field = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      eventName = value;
      continue;
    }

    if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    dataText: dataLines.join('\n'),
  };
}

function ensurePendingSseMessageWithinLimit(buffer, maxBytes) {
  if (Buffer.byteLength(buffer, 'utf8') > maxBytes) {
    throw new Error(`Image stream exceeded maximum SSE event buffer size (${maxBytes} bytes)`);
  }
}

function operationEventNames(operation) {
  const operationPrefix = operation === 'edit' ? 'image_edit' : 'image_generation';
  return {
    operationPrefix,
    partialEvent: `${operationPrefix}.partial_image`,
    completedEvent: `${operationPrefix}.completed`,
    errorEvents: new Set([
      'error',
      `${operationPrefix}.error`,
      `${operationPrefix}.failed`,
      `${operationPrefix}.failure`,
    ]),
  };
}

function parseJsonForEvent(eventName, dataText) {
  try {
    return JSON.parse(dataText);
  } catch {
    throw new Error(`Image stream included invalid JSON for event "${eventName}"`);
  }
}

function parseJsonForErrorEvent(eventName, dataText) {
  try {
    return JSON.parse(dataText);
  } catch {
    throw new Error(`Image stream included invalid JSON for error event "${eventName}"`);
  }
}

function getErrorDetails(payload) {
  if (typeof payload === 'string') {
    return { hasError: true, message: payload };
  }

  if (!payload || typeof payload !== 'object') {
    return { hasError: false };
  }

  const innerError = payload.error;
  if (typeof innerError === 'string') {
    return {
      hasError: true,
      message: innerError,
      type: payload.type,
      status: payload.status,
      code: payload.code,
    };
  }

  if (innerError && typeof innerError === 'object') {
    return {
      hasError: true,
      message: innerError.message ?? payload.message,
      type: innerError.type ?? payload.type,
      status: innerError.status ?? payload.status,
      code: innerError.code ?? payload.code,
    };
  }

  if (typeof payload.message === 'string') {
    return {
      hasError: true,
      message: payload.message,
      type: payload.type,
      status: payload.status,
      code: payload.code,
    };
  }

  return { hasError: false };
}

function buildStreamErrorMessage(eventName, payload) {
  const details = getErrorDetails(payload);
  const summary = [];

  if (details.type !== undefined) {
    summary.push(`type=${details.type}`);
  }
  if (details.status !== undefined) {
    summary.push(`status=${details.status}`);
  }
  if (details.code !== undefined) {
    summary.push(`code=${details.code}`);
  }

  const suffix = summary.length > 0 ? ` (${summary.join(', ')})` : '';
  if (details.message) {
    return `Image stream reported error for event "${eventName}": ${details.message}${suffix}`;
  }

  return `Image stream reported error for event "${eventName}"${suffix}`;
}

async function* readSseEvents(body, { maxBufferBytes = MAX_PENDING_SSE_MESSAGE_BUFFER_BYTES } = {}) {
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('Image stream response body is not readable');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        completed = true;
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(value, { stream: true });
      }

      while (true) {
        const delimiterMatch = /\r?\n\r?\n/.exec(buffer);
        if (!delimiterMatch) {
          break;
        }

        const block = buffer.slice(0, delimiterMatch.index);
        buffer = buffer.slice(delimiterMatch.index + delimiterMatch[0].length);
        ensurePendingSseMessageWithinLimit(block, maxBufferBytes);

        const parsed = parseSseEventBlock(block);
        if (parsed) {
          yield parsed;
        }
      }

      ensurePendingSseMessageWithinLimit(buffer, maxBufferBytes);

      if (done) {
        break;
      }
    }

    const trailing = parseSseEventBlock(buffer);
    if (trailing) {
      yield trailing;
    }
  } finally {
    if (!completed && typeof reader.cancel === 'function') {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation failures from already-closed streams.
      }
    }

    if (typeof reader.releaseLock === 'function') {
      try {
        reader.releaseLock();
      } catch {
        // Ignore release failures if lock is already gone.
      }
    }
  }
}

async function collectStreamingImage(response, operation) {
  const { operationPrefix, partialEvent, completedEvent, errorEvents } = operationEventNames(operation);

  let partialImageCount = 0;

  for await (const event of readSseEvents(response.body)) {
    const isPartialImage = event.event === partialEvent;
    const isCompletedImage = event.event === completedEvent;
    const isErrorEvent = errorEvents.has(event.event);

    if (!isPartialImage && !isCompletedImage && !isErrorEvent) {
      continue;
    }

    const payload = isErrorEvent
      ? parseJsonForErrorEvent(event.event, event.dataText)
      : parseJsonForEvent(event.event, event.dataText);

    const errorDetails = getErrorDetails(payload);
    if (isErrorEvent || (event.event.startsWith(operationPrefix) && errorDetails.hasError)) {
      throw new Error(buildStreamErrorMessage(event.event, payload));
    }

    if (isPartialImage) {
      partialImageCount += 1;
      continue;
    }

    if (isCompletedImage) {
      return {
        payload,
        partialImageCount,
      };
    }
  }

  throw new Error(`Streaming ${operation} response ended with no completed image event`);
}

async function runImageOperation({
  operation,
  prompt,
  imageUrl,
  config,
  fetchImpl,
  now,
  randomId,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime');
  }

  const normalizedPrompt = normalizePrompt(prompt);
  const normalizedImageUrl = operation === 'edit' ? normalizeImageUrl(imageUrl) : undefined;
  const request = buildImageRequestOptions(config, {
    operation,
    prompt: normalizedPrompt,
    imageUrl: normalizedImageUrl,
  });

  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Image ${operation} request failed with HTTP ${response.status}: ${body}`);
  }

  let payload;
  let streamed = false;
  let partialImageCount = 0;

  if (isStreamingResponse(config, response)) {
    const streamingImage = await collectStreamingImage(response, operation);
    payload = streamingImage.payload;
    streamed = true;
    partialImageCount = streamingImage.partialImageCount;
  } else {
    payload = await response.json();
  }

  const payloadFormat = String(payload.output_format || config.outputFormat || 'png').toLowerCase();
  const fallbackMimeType = MIME_BY_EXTENSION[payloadFormat] ?? 'image/png';
  const image = extractImageData(payload, fallbackMimeType);
  const extension = extensionFromConfig(config, image.mimeType);
  const filePrefix = operation === 'edit' ? 'gpt-image-edit' : 'gpt-image';
  const fileName = `${filePrefix}-${timestamp(now())}-${randomId()}.${extension}`;
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
    streamed,
    partialImageCount,
  };
}

export async function generateImage({
  prompt,
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomId = defaultRandomId,
}) {
  return runImageOperation({
    operation: 'generation',
    prompt,
    config,
    fetchImpl,
    now,
    randomId,
  });
}

export async function editImage({
  prompt,
  imageUrl,
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomId = defaultRandomId,
}) {
  return runImageOperation({
    operation: 'edit',
    prompt,
    imageUrl,
    config,
    fetchImpl,
    now,
    randomId,
  });
}
