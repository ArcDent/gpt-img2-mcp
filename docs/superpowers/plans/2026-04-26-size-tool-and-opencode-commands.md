# Size Tool and OpenCode Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second MCP image tool that accepts `prompt` plus per-call `size`, add three OpenCode slash commands, and document the update.

**Architecture:** Keep the existing `generate_image` tool unchanged so `/imggeneration` can call it with user-provided prompt only. Add a new `generate_image_with_size` tool that validates `prompt` and `size`, clones the env-loaded config with a per-call size override, and reuses the same `generateImage` client. Add project-local `.opencode/commands/*.md` files whose `$ARGUMENTS` become the prompt and whose small/large commands instruct OpenCode to call the size-aware tool with fixed sizes.

**Tech Stack:** Node.js ESM, Node built-in test runner, `@modelcontextprotocol/sdk`, OpenCode markdown custom commands.

---

## File Structure

- Modify `src/config.js`: add a small helper for overriding `config.size` for one request.
- Modify `src/server.js`: export two tool names, schemas for prompt-only and prompt+size tools, and register both tools.
- Modify `test/config.test.js`: cover the one-request size override helper.
- Modify `test/server.test.js`: cover both tool schemas and verify the original prompt remains dynamic.
- Create `.opencode/commands/imggeneration.md`: prompt-only command using the existing tool.
- Create `.opencode/commands/imggeneration-small.md`: command using fixed small size `1024x1024`.
- Create `.opencode/commands/imggeneration-large.md`: command using fixed large size `1536x1024`.
- Modify `README.md`: document the new tool, three commands, command file installation, and that prompt is not fixed.

## Tasks

### Task 1: TDD config size override

- [ ] Add a failing test to `test/config.test.js` asserting `withSizeOverride(config, '1536x1024')` returns a copy with `size: '1536x1024'` and does not mutate the original config.
- [ ] Run `npm test -- test/config.test.js` and verify it fails because `withSizeOverride` is not exported.
- [ ] Implement `withSizeOverride(config, size)` in `src/config.js` with non-empty string validation.
- [ ] Run `npm test -- test/config.test.js` and verify it passes.

### Task 2: TDD MCP tool schemas

- [ ] Update `test/server.test.js` to expect `TOOL_NAMES.generateImage === 'generate_image'`, `TOOL_NAMES.generateImageWithSize === 'generate_image_with_size'`, the existing prompt-only schema to still expose only `prompt`, and the new size schema to expose exactly `prompt` and `size`.
- [ ] Add an assertion that the prompt schema description does not contain a fixed example prompt like `一张抖音主页面图片`.
- [ ] Run `npm test -- test/server.test.js` and verify it fails because the new exports/schema do not exist yet.
- [ ] Update `src/server.js` to register `generate_image_with_size` and route it through `withSizeOverride(loadConfig(env), size)`.
- [ ] Run `npm test -- test/server.test.js` and verify it passes.

### Task 3: Add OpenCode command files

- [ ] Create `.opencode/commands/imggeneration.md` with `$ARGUMENTS` as the user prompt and instructions to call MCP tool `generate_image`.
- [ ] Create `.opencode/commands/imggeneration-small.md` with `$ARGUMENTS` as the user prompt and fixed `size: "1024x1024"` for `generate_image_with_size`.
- [ ] Create `.opencode/commands/imggeneration-large.md` with `$ARGUMENTS` as the user prompt and fixed `size: "1536x1024"` for `generate_image_with_size`.
- [ ] Self-check by reading the command files and confirming none of them hardcode a fixed prompt; they all use `$ARGUMENTS`.

### Task 4: README update

- [ ] Update README introduction from “只暴露一个工具” to “暴露两个工具”.
- [ ] Document `generate_image` and `generate_image_with_size` with their exact JSON inputs.
- [ ] Document the three OpenCode slash commands and the `.opencode/commands/*.md` files.
- [ ] Document the default sizes: small `1024x1024`, large `1536x1024`.
- [ ] Add a note that the existing tool prompt is not fixed; it always comes from MCP tool input / command `$ARGUMENTS`.

### Task 5: Final verification

- [ ] Run `npm test`.
- [ ] Run `node --check src/server.js && node --check src/config.js && node --check src/imageClient.js`.
- [ ] Run a secret/prompt sanity check confirming no API key is present and command files use `$ARGUMENTS`.
