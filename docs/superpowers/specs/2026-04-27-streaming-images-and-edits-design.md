# Streaming Images and Edits Design Spec

## Goal

Update `gpt-img2-mcp` so CPA image requests use streaming SSE by default, preventing long non-streaming image calls from timing out, and add explicit support for CPA `/v1/images/edits` alongside existing `/v1/images/generations`.

## Context

The current MCP client posts JSON to `${GPT_IMG2_BASE_URL}/images/generations` without `stream: true` and parses the response with `response.json()`. CLIProxyAPI supports streaming image generation when the request includes `stream: true`; the stream emits events such as `image_generation.partial_image` and `image_generation.completed`. Without streaming, slow image calls can time out before the final JSON arrives.

CPA also exposes `/v1/images/edits`. The MCP should support that endpoint with the same streaming client path rather than duplicating a separate non-streaming parser.

## In Scope

1. Add request-building support for two operations:
   - `generation`: POST `${baseUrl}/images/generations`
   - `edit`: POST `${baseUrl}/images/edits`
2. Add `stream: true` to generation and edit request bodies by default.
3. Parse Server-Sent Events from CPA streaming image responses.
4. Save the final completed image from:
   - `image_generation.completed`
   - `image_edit.completed`
5. Ignore partial-image events for file saving, but count them and expose the count in the returned metadata.
6. Preserve existing non-streaming JSON parsing as a fallback when the upstream response is JSON rather than SSE.
7. Add MCP edit tools for `/v1/images/edits`.
8. Document streaming behavior, edit configuration, and edit tool usage in `README.md`.

## Out of Scope

1. No live progress callbacks to OpenCode while partial images arrive; the MCP tool returns once the final completed event is saved.
2. No multipart upload from MCP. Edit tools accept image data URLs only, because stdio MCP inputs are JSON-friendly.
3. No mask support in the first edit implementation.
4. No multi-image output saving; save the first final image from the completed event, matching current single-image behavior.

## Public MCP Tools

Existing tools stay compatible:

1. `generate_image`
   - Input: `{ "prompt": string }`
   - Uses configured `GPT_IMG2_SIZE`.
   - Calls streaming `/images/generations`.

2. `generate_image_with_size`
   - Input: `{ "prompt": string, "size": string }`
   - Uses per-call size override.
   - Calls streaming `/images/generations`.

New edit tools:

3. `edit_image`
   - Input: `{ "prompt": string, "image_url": string }`
   - `image_url` must be a non-empty string, normally a `data:image/...;base64,...` URL.
   - Uses configured `GPT_IMG2_SIZE`.
   - Calls streaming `/images/edits` with JSON body `{ images: [{ image_url }] }`.

4. `edit_image_with_size`
   - Input: `{ "prompt": string, "image_url": string, "size": string }`
   - Uses per-call size override.
   - Calls streaming `/images/edits` with JSON body `{ images: [{ image_url }] }`.

## Configuration

Keep current env names and defaults:

- `GPT_IMG2_BASE_URL` required.
- `GPT_IMG2_API_KEY` optional.
- `GPT_IMG2_MODEL`, `GPT_IMG2_SIZE`, `GPT_IMG2_QUALITY`, `GPT_IMG2_OUTPUT_FORMAT`, `GPT_IMG2_RESPONSE_FORMAT`, `GPT_IMG2_OUTPUT_DIR`, `GPT_IMG2_BACKGROUND`, `GPT_IMG2_MODERATION`, `GPT_IMG2_OUTPUT_COMPRESSION`, `GPT_IMG2_PARTIAL_IMAGES`, `GPT_IMG2_USER_AGENT` keep existing behavior.

Add one optional env flag:

- `GPT_IMG2_STREAM`: defaults to `true`; accepts `true`, `1`, `yes`, `on`, `false`, `0`, `no`, `off`. When false, request bodies omit `stream: true` and use existing JSON fallback behavior. This is for compatibility/debugging only; README should recommend keeping streaming enabled for CPA.

## Request Construction

Create a single request builder for image operations:

```js
buildImageRequestOptions(config, {
  operation: 'generation' | 'edit',
  prompt,
  imageUrl,
})
```

Rules:

- `generation` endpoint is `${baseUrl}/images/generations`.
- `edit` endpoint is `${baseUrl}/images/edits`.
- Common body fields: `model`, `prompt`, `size`, `quality`, `output_format`, `response_format`.
- Optional fields remain mapped to CPA names: `background`, `moderation`, `output_compression`, `partial_images`.
- When `config.stream !== false`, include `stream: true`.
- For `edit`, include `images: [{ image_url: imageUrl }]` and reject missing/blank `imageUrl` before network access.

Keep `buildRequestOptions(config, prompt)` as a compatibility wrapper around generation request construction so existing tests and imports continue to work.

## Streaming Parser

Add a focused SSE parser module or helper in `src/imageClient.js`.

Requirements:

- Accept chunks from `response.body` using a Web Streams reader.
- Decode bytes with `TextDecoder`.
- Split SSE messages on blank lines.
- Support standard `event:` and `data:` lines.
- Ignore comments and unknown event names.
- Parse JSON in `data:`.
- Count events ending in `.partial_image`.
- Capture the first final image payload from:
  - `image_generation.completed`
  - `image_edit.completed`
- Also tolerate final image JSON embedded in generic completion payloads if shaped like OpenAI image response data.
- Throw a clear error if the stream ends without a final image.

Expected final extraction accepts either:

```json
{
  "b64_json": "...",
  "revised_prompt": "..."
}
```

or:

```json
{
  "url": "data:image/png;base64,...",
  "revised_prompt": "..."
}
```

and also accepts `{ "data": [ ... ] }` for fallback compatibility.

## Client API

Keep `generateImage(...)` as the generation API.

Add:

```js
editImage({ prompt, imageUrl, config, fetchImpl, now, randomId })
```

Both functions should call a shared internal operation runner that:

1. Validates prompt.
2. Builds the operation-specific request.
3. Sends POST.
4. On non-OK responses, includes upstream status and text body in the thrown error.
5. If response is SSE or has a readable stream body, parses streaming events.
6. If response is JSON, parses the current non-streaming shape.
7. Saves the final image file to `config.outputDir`.
8. Returns metadata including:
   - `path`
   - `fileName`
   - `bytes`
   - `mimeType`
   - `revisedPrompt`
   - `model`
   - `size`
   - `quality`
   - `outputFormat`
   - `operation`
   - `streamed`
   - `partialImageCount`

## Output File Naming

Use operation-specific prefixes:

- Generation: `gpt-image-YYYYMMDD-HHMMSS-random.ext` (unchanged)
- Edit: `gpt-image-edit-YYYYMMDD-HHMMSS-random.ext`

## Error Handling

- Empty prompt: `prompt must be a non-empty string`.
- Empty edit image URL: `image_url must be a non-empty string`.
- Non-OK upstream response: include `HTTP <status>: <body>`.
- Malformed data URL: clear error that the image response included an invalid data URL.
- SSE stream ends without a final image: clear error that no completed image event was received.

## Tests

Use Node's built-in `node:test` runner.

Required test coverage:

1. Config/request builder:
   - `loadConfig` defaults `stream` to true.
   - Boolean env parsing for `GPT_IMG2_STREAM`.
   - Generation request includes `stream: true` by default.
   - Generation request omits stream when disabled.
   - Edit request targets `/images/edits` and includes `images: [{ image_url }]`.

2. Image client streaming:
   - `generateImage` parses `image_generation.partial_image` and `image_generation.completed`, saves final b64 image, and returns `streamed: true` plus partial count.
   - `generateImage` parses final data URL from streaming completed event.
   - Stream end without completed image rejects clearly.
   - Existing non-streaming JSON tests still pass.

3. Edit client:
   - `editImage` posts to `/images/edits` with `stream: true` and JSON image URL.
   - `editImage` saves `image_edit.completed` output with `gpt-image-edit-...` filename.
   - `editImage` rejects blank image URL before network access.

4. MCP schemas:
   - Existing tool schemas remain unchanged.
   - New `edit_image` schema requires only `prompt` and `image_url`.
   - New `edit_image_with_size` schema requires only `prompt`, `image_url`, and `size`.

## Documentation

README must explain:

- The MCP uses streaming image requests by default because CPA non-streaming calls may time out.
- `GPT_IMG2_STREAM` exists and defaults to true.
- `/v1/images/generations` and `/v1/images/edits` are both supported.
- Edit tools require image data URL input.
- Partial images are consumed internally and counted, but only the final completed image is saved.
- OpenCode MCP config examples should include `GPT_IMG2_STREAM: "true"`.

## Acceptance Criteria

- `npm test` passes.
- `node --check` passes for all `src/*.js` and `test/*.js` files.
- README contains streaming guidance, edit tool examples, and `GPT_IMG2_STREAM` docs.
- Git branch is `ArcDev`.
- Changes are committed and pushed to `origin/ArcDev`.
- A PR from `ArcDev` to `main` exists or is updated.

## Spec Self-Review

- Placeholder scan: no `TBD`, `TODO`, or open-ended placeholders remain.
- Scope check: the spec covers one cohesive change: streaming image client plus edit endpoint support. Multipart/mask/progress streaming are intentionally out of scope.
- Ambiguity check: tool names, inputs, endpoint paths, env flag behavior, saved-file naming, and parser requirements are explicit.
- Testability check: every behavior has a concrete test target using existing Node test infrastructure.
