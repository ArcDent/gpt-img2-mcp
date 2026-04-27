const DEFAULTS = {
  model: 'gpt-image-2',
  size: '1024x1024',
  quality: 'high',
  outputFormat: 'png',
  responseFormat: 'b64_json',
  userAgent: 'gpt-img2-mcp/0.1.0',
};

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function optionalString(env, key) {
  const value = env[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  return String(value).trim();
}

function optionalNumber(env, key) {
  const raw = optionalString(env, key);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number`);
  }
  return parsed;
}

function optionalBoolean(env, key) {
  const raw = optionalString(env, key);
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  throw new Error(`${key} must be a boolean`);
}

export function loadConfig(env = process.env) {
  const rawBaseUrl = optionalString(env, 'GPT_IMG2_BASE_URL');
  if (!rawBaseUrl) {
    throw new Error('GPT_IMG2_BASE_URL is required');
  }

  return {
    baseUrl: trimTrailingSlash(rawBaseUrl),
    apiKey: optionalString(env, 'GPT_IMG2_API_KEY'),
    model: optionalString(env, 'GPT_IMG2_MODEL') ?? DEFAULTS.model,
    size: optionalString(env, 'GPT_IMG2_SIZE') ?? DEFAULTS.size,
    quality: optionalString(env, 'GPT_IMG2_QUALITY') ?? DEFAULTS.quality,
    outputFormat: optionalString(env, 'GPT_IMG2_OUTPUT_FORMAT') ?? DEFAULTS.outputFormat,
    responseFormat: optionalString(env, 'GPT_IMG2_RESPONSE_FORMAT') ?? DEFAULTS.responseFormat,
    outputDir: optionalString(env, 'GPT_IMG2_OUTPUT_DIR') ?? process.cwd(),
    stream: optionalBoolean(env, 'GPT_IMG2_STREAM') ?? true,
    background: optionalString(env, 'GPT_IMG2_BACKGROUND'),
    moderation: optionalString(env, 'GPT_IMG2_MODERATION'),
    outputCompression: optionalNumber(env, 'GPT_IMG2_OUTPUT_COMPRESSION'),
    partialImages: optionalNumber(env, 'GPT_IMG2_PARTIAL_IMAGES'),
    userAgent: optionalString(env, 'GPT_IMG2_USER_AGENT') ?? DEFAULTS.userAgent,
  };
}

export function withSizeOverride(config, size) {
  const normalizedSize = String(size ?? '').trim();
  if (!normalizedSize) {
    throw new Error('size must be a non-empty string');
  }

  return {
    ...config,
    size: normalizedSize,
  };
}

function buildHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': config.userAgent,
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  return headers;
}

function buildImageRequestBody(config, prompt) {
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

export function buildImageRequestOptions(config, { operation, prompt, imageUrl }) {
  let endpoint;
  if (operation === 'generation') {
    endpoint = 'generations';
  } else if (operation === 'edit') {
    endpoint = 'edits';
  } else {
    throw new Error('operation must be either "generation" or "edit"');
  }

  const body = buildImageRequestBody(config, prompt);

  if (operation === 'edit') {
    const normalizedImageUrl = String(imageUrl ?? '').trim();
    if (!normalizedImageUrl) {
      throw new Error('image_url must be a non-empty string');
    }

    body.images = [{ image_url: normalizedImageUrl }];
  }

  return {
    url: `${config.baseUrl}/images/${endpoint}`,
    headers: buildHeaders(config),
    body,
  };
}

export function buildRequestOptions(config, prompt) {
  return buildImageRequestOptions(config, { operation: 'generation', prompt });
}
