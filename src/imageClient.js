import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildRequestOptions } from './config.js';

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function normalizePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('prompt must be a non-empty string');
  }
  return prompt.trim();
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

function extractImageData(payload, fallbackMimeType) {
  const item = payload?.data?.[0];
  if (!item || typeof item !== 'object') {
    throw new Error('Image generation response did not include data[0]');
  }

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

export async function generateImage({
  prompt,
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomId = defaultRandomId,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime');
  }

  const normalizedPrompt = normalizePrompt(prompt);
  const request = buildRequestOptions(config, normalizedPrompt);
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Image generation request failed with HTTP ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const payloadFormat = String(payload.output_format || config.outputFormat || 'png').toLowerCase();
  const fallbackMimeType = MIME_BY_EXTENSION[payloadFormat] ?? 'image/png';
  const image = extractImageData(payload, fallbackMimeType);
  const extension = extensionFromConfig(config, image.mimeType);
  const fileName = `gpt-image-${timestamp(now())}-${randomId()}.${extension}`;
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
  };
}
