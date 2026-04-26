# Prompt-only GPT Image MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight stdio MCP server that exposes exactly one image-generation tool accepting only `prompt`.

**Architecture:** The MCP server reads all CPA/OpenAI Images API parameters from environment variables configured in OpenCode, validates the single `prompt` argument, calls `${GPT_IMG2_BASE_URL}/images/generations`, saves the returned image into the configured output directory, and returns a short JSON summary. Core request/config/output logic is separated from the MCP transport so it can be tested without launching an MCP client.

**Tech Stack:** Node.js ESM, Node built-in test runner, `@modelcontextprotocol/sdk`, Node built-in `fetch`, `fs`, `path`, and `crypto`.

---

## File Structure

- Create `package.json`: package metadata, bin entry, scripts, dependency.
- Create `src/config.js`: environment-variable parsing and validation.
- Create `src/imageClient.js`: CPA image request, response parsing, output save orchestration.
- Create `src/server.js`: stdio MCP server and single `generate_image` tool.
- Create `test/config.test.js`: config behavior tests.
- Create `test/imageClient.test.js`: request/body/header/output behavior tests.
- Create `README.md`: manual installation and OpenCode `opencode.jsonc` MCP configuration guide.

## Tasks

### Task 1: Verify CPA chain with provided temporary credentials

- [ ] Run one image-generation request against `https://api.arcdent.me/v1/images/generations` using prompt `一张抖音主页面图片`.
- [ ] Save the decoded image in the project directory as `cpa-link-test.png`.
- [ ] Self-check that the file exists and has non-zero size.

### Task 2: Add package scaffold

- [ ] Create `package.json` with ESM mode, `gpt-img2-mcp` bin, `start`, and `test` scripts.
- [ ] Run `npm install`.
- [ ] Self-check that `node_modules` and `package-lock.json` are created.

### Task 3: TDD config parser

- [ ] Write failing tests in `test/config.test.js` covering defaults, optional auth header behavior, and numeric env parsing.
- [ ] Run the config test and verify it fails because `src/config.js` does not exist yet.
- [ ] Implement `src/config.js` minimally.
- [ ] Run the config test and verify it passes.

### Task 4: TDD image client

- [ ] Write failing tests in `test/imageClient.test.js` covering request URL/body/header and image file creation from `b64_json`.
- [ ] Run the image client test and verify it fails because `src/imageClient.js` does not exist yet.
- [ ] Implement `src/imageClient.js` minimally.
- [ ] Run the image client test and verify it passes.

### Task 5: MCP server

- [ ] Create `src/server.js` exposing exactly one MCP tool named `generate_image`.
- [ ] Self-check the tool input schema has only `prompt` and `additionalProperties: false`.
- [ ] Run all tests and syntax checks.

### Task 6: Documentation

- [ ] Create `README.md` with manual install steps.
- [ ] Document OpenCode `opencode.jsonc` MCP configuration prominently, including env placeholders and image parameters.
- [ ] Self-check README contains no real API key and makes clear the tool argument is only `prompt`.

### Task 7: Final verification

- [ ] Run `npm test`.
- [ ] Run a local smoke check that `src/server.js` can start long enough to initialize.
- [ ] Review created files for accidental secret persistence.
