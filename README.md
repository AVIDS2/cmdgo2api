# Command Code Proxy

> [中文文档](README_zh.md)

A reverse proxy that converts Command Code API to OpenAI / Anthropic compatible endpoints. The proxy core remains a single file; the optional Web console is provided as a separate management layer.

Built by analyzing official CLI network traffic to accurately replicate the Command Code API request protocol, including device-fingerprint and lifecycle pre-requests.

**Features**: OpenAI Chat Completions + Anthropic Messages API | Streaming & non-streaming | Tool calling (tool_use) | Multimodal image input | Reasoning effort | Dynamic upstream model catalog | Console model allowlist | Multiple gateway keys | Multi-account token storage and one-click switching | Per-account five-hour, weekly, and total remaining quotas | Cookie-protected Web console | Command Code browser authorization | Minute-level background usage refresh | Update and restart | Cache hit metrics | Device fingerprint disguise (per-key, auto-refresh) | `x-api-key` auth (Anthropic SDK) | Client disconnect detection with upstream abort | Zero-output → 429 auto-retry | Consecutive timeout → 429 auto-retry | Privacy-aware logging

**Community**: [Linux.do](https://linux.do) — a friendly Chinese tech community.

## Quick Start

```bash
npm --prefix web ci --ignore-scripts
npm --prefix web run build
npm start        # Start (the repo ships with config.json listening on http://0.0.0.0:3050)
```

Open `http://127.0.0.1:3050/console`. On first access without a gateway key, the console asks you to set the first key. It becomes both the public console password and the first proxy access key. After signing in, select **Browser login** and complete the official Command Code authorization.

When gateway keys are configured, API clients send a gateway key using the `Authorization: Bearer` header (or `x-api-key` for Anthropic SDKs). Without gateway keys, the original `user_` upstream-key compatibility remains available:

```bash
curl http://127.0.0.1:3050/v1/chat/completions \
  -H "Authorization: Bearer user_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}'
```

## Quick Deployment

### From Source

Node.js 18 or newer is required. Install frontend dependencies and build once, then start the proxy:

```bash
git clone https://git.1dea.top/aidea/cmd2api.git
cd cmd2api
npm --prefix web ci --ignore-scripts
npm --prefix web run build
npm start
```

Open `http://127.0.0.1:3050/console`, set the gateway key, and select **Add account** to complete the official Command Code browser authorization. Account tokens, gateway keys, and quota snapshots are stored in the runtime directories; keep those directories when upgrading or recreating a container.

### Docker Compose

```bash
docker compose up -d --build
docker compose logs -f proxy
```

The default host port is `3050`. Override it with `PROXY_PORT=13050 docker compose up -d --build`. Compose mounts both runtime and account directories, so saved accounts survive container restarts.

## File Structure

```
commandcode/
├── config.json           # Port / log path etc.
├── LICENSE               # MIT License
├── package.json          # npm start / npm run dev
├── proxy.mjs             # Single-file proxy core (~1900 lines)
├── web/                  # Web console, admin API, and frontend build project
├── Dockerfile            # Container build (node:22-alpine)
├── docker-compose.yml    # Container orchestration
├── .dockerignore         # Build context exclusions
├── .github/
│   └── workflows/
│       └── docker-publish.yml  # GHCR multi-arch publish on v* tags
├── captured-requests/    # Captured CLI traffic (protocol analysis reference)
├── README.md             # This document (English)
└── README_zh.md          # Chinese documentation
```

## Configuration

### config.json

| Field | Default | Description |
|------|--------|-------------|
| `port` | `3000` | Listen port (repo config.json ships with `3050`) |
| `host` | `0.0.0.0` | Listen address |
| `publicUrl` | `""` | Public origin used for browser auth callbacks; derived from the request when empty |
| `apiBase` | `https://api.commandcode.ai` | CC API base URL |
| `projectSlug` | `cc-proxy` | `x-project-slug` header |
| `apiKey` | `""` | Optional fallback API key (requests can also send it via header) |
| `gatewayApiKey` | `""` | Legacy single gateway key; manage multiple keys in the Web console |
| `gatewayApiKeys` | `[]` | Optional gateway-key array; the first key is also the console password |
| `allowedModelIds` | `null` | Optional model allowlist; `null` allows all models and console settings are stored in the runtime directory |
| `logFile` | `""` | Log file path (empty = console only) |
| `logLevel` | `info` | Log level |
| `useProviderModels` | `true` | Dynamically fetch model list from Provider API |
| `modelRefreshIntervalMs` | `300000` | Model list cache refresh interval (5 min) |
| `zdr` | `false` | Request ZDR-only routing from Command Code |

### Environment Variables

| Variable | Overrides |
|----------|-----------|
| `PORT` | `port` |
| `HOST` | `host` |
| `CC_PUBLIC_URL` | `publicUrl`; recommended when using a fixed public domain |
| `CONSOLE_PUBLIC_URL` | `publicUrl`; compatibility alias for `CC_PUBLIC_URL` |
| `CC_API_BASE` | `apiBase` |
| `PROJECT_SLUG` | `projectSlug` |
| `GATEWAY_API_KEY` | `gatewayApiKey` |
| `GATEWAY_API_KEYS_JSON` | `gatewayApiKeys` (advanced) |
| `CC_API_KEY` | Command Code upstream API key |
| `LOG_FILE` | `logFile` |
| `CC_USE_PROVIDER_MODELS` | `useProviderModels` |
| `CMD_ZDR` | `zdr` (`1` to enable) |

When enabled, the proxy sends `x-cmd-zdr: 1` on Command Code generation requests
and the fingerprint/lifecycle initialization requests. It does not add the header
to the npm version check or the proxy's `/provider/v1/models` catalog request.
This requests Command Code's ZDR-only routing; the upstream service remains the
authority for actual retention and provider availability.

**Request body limit**: independent of `config.json` — requests larger than **100 MB** are rejected with `HTTP 413` (the connection is kept alive and drained, not reset). Override with `CC_MAX_BODY_MB` (positive integer, unit: MB).

With gateway keys configured, clients authenticate to this proxy with any gateway key while the proxy uses `CC_API_KEY` for Command Code. Without gateway keys, clients may still provide a `user_...` upstream key directly.

### Web Console

The console is available at `/console`; its management API is under `/admin/api`. The public endpoints are limited to first-time setup, login, and service status. After setup, keys, usage, model permissions, restart, and update operations require the console session cookie.

- The first gateway key is the public console password. Deleting it promotes the next key; deleting the last key returns to first-time setup.
- Add or delete gateway keys without restarting the process. The first key can also be replaced, which invalidates console sessions.
- Use **Browser login** to store multiple Command Code account tokens locally. The account list supports one-click switching, deletion, and refreshing all accounts; each row shows only the remaining five-hour, weekly, and total quotas. Switching updates the proxy's active upstream token immediately without a restart.
- The model manager reads the full catalog from the upstream Provider API. All models are allowed by default; saved restrictions hide models from `/v1/models` and return `HTTP 403` for direct calls.
- Usage refreshes in the background every 60 seconds while the console is open.
- Update and restart runs only when the Git worktree is clean, using `git pull --ff-only`, frontend dependency installation, and a production build. Local changes are refused rather than overwritten.
- Browser authorization now returns to the proxy service instead of always redirecting to the visitor's machine. When `CC_PUBLIC_URL` is not set, the callback is derived from `X-Forwarded-Proto`, `X-Forwarded-Host`, and `Host`; behind a reverse proxy or fixed domain, set `CC_PUBLIC_URL=https://console.example.com` and forward `/callback` to the proxy. HTTPS is recommended for public deployments.

Runtime credentials are stored in `~/.config/commandcode-proxy/credentials.env`, model settings in `~/.config/commandcode-proxy/settings.json`, and multiple account tokens plus cached quotas in `~/.config/commandcode-proxy/accounts.json`. The active account is also mirrored to `~/.commandcode/auth.json` for compatibility. Files are created with restrictive permissions; an older single-account `auth.json` is migrated automatically and must not be committed or copied to a public directory.

## API Endpoints

### `POST /v1/chat/completions`

OpenAI Chat Completions compatible. Supports streaming, non-streaming, tool calling, multimodal image input, and reasoning effort.

**Request parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `model` | Yes | Model ID (see model list) |
| `messages` | Yes | Conversation messages, supports `system/user/assistant/tool` roles |
| `max_tokens` | No | Max tokens to generate (default 64000) |
| `stream` | No | SSE streaming (default false) |
| `temperature` | No | Sampling temperature (0-2) |
| `reasoning_effort` | No | Reasoning intensity: `low`/`medium`/`high`/`max` |
| `tools` | No | Tool definitions (OpenAI function calling format) |
| `tool_choice` | No | Tool selection strategy |
| `parallel_tool_calls` | No | Allow parallel tool calls |

**Simple request:**
```json
{
  "model": "deepseek/deepseek-v4-flash",
  "messages": [{ "role": "user", "content": "hello" }],
  "stream": true
}
```

**Multimodal image input (vision model required):**
```json
{
  "model": "xiaomi/mimo-v2.5",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "Describe this image" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ]
  }]
}
```

**Tool calling:**
```json
{
  "model": "deepseek/deepseek-v4-flash",
  "messages": [...],
  "tools": [{
    "type": "function",
    "function": { "name": "get_weather", "description": "...", "parameters": {...} }
  }],
  "tool_choice": "auto"
}
```

**Streaming response (SSE):**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"thinking..."}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"prompt_tokens_details":{"cached_tokens":8}}}

data: [DONE]
```

**Non-streaming response (with cache hits):**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "deepseek/deepseek-v4-flash",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello!",
      "reasoning_content": "The user said hello, I should respond."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 7558,
    "completion_tokens": 42,
    "total_tokens": 7600,
    "prompt_tokens_details": { "cached_tokens": 7552 }
  }
}
```

### `POST /v1/messages`

Anthropic Messages API compatible endpoint. Supports streaming, non-streaming, and tool calling.

**Request body:**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1000,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "stream": true
}
```

**Anthropic protocol conversion (automatic):**

| Concept | Anthropic Format | Conversion |
|---------|-----------------|------------|
| System prompt | Top-level `system` field | Auto-converted to OpenAI `system` message |
| Message content | `content` array (text/tool_use/tool_result) | Auto-mapped to corresponding roles |
| Tool results | `tool_result` blocks in `user` messages | Auto-converted to `role: "tool"` |
| Tool definitions | `input_schema` | Auto-mapped to `parameters` |
| `tool_choice` | `{type:"auto"/"any"/"tool"}` | `any`→`required`, `tool`→function object |
| Reasoning | `thinking.budget_tokens` | Auto-mapped to `reasoning_effort` (≥10000→high, ≥5000→medium, ≥2000→low) |
| Stop reason | `end_turn`/`max_tokens`/`tool_use` | Auto-mapped to `stop`/`length`/`tool_calls` |
| Token usage | `input_tokens`/`output_tokens` + cache | Passed through, cache fields mapped to Anthropic format |

**Streaming response (SSE, Anthropic format):**
```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"...","usage":{"input_tokens":0,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10,"cache_read_input_tokens":0,"input_tokens":100}}

event: message_stop
data: {"type":"message_stop"}
```

**Non-streaming response:**
```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "model": "deepseek/deepseek-v4-flash",
  "content": [{ "type": "text", "text": "Hello!" }],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 7558,
    "output_tokens": 42,
    "cache_read_input_tokens": 7552,
    "cache_creation_input_tokens": null
  }
}
```

### `GET /v1/models`

Returns available model list. Fetched dynamically from Provider API (5 min cache), falls back to hardcoded list on failure.

### `GET /health`

Health check. Returns `OK`.

## Error Codes

| HTTP Status | Description |
|-------------|-------------|
| 400 | Invalid request format |
| 401 | API Key missing / invalid format / rejected (Key must start with `user_`; sent via `Authorization: Bearer` or `x-api-key`) |
| 429 | Zero output tokens, or idle timeout (30s streaming / 90s non-streaming) — SDK auto-retry with `Retry-After`; after 3 consecutive timeouts a "reduce context" hint is returned |
| 502 | CC upstream error |

## Model List

The proxy returns a live model list via `GET /v1/models`. Below are common models for reference; the actual list depends on the live API response — see [Command Code Pricing](https://commandcode.ai/docs/resources/pricing-limits) for plan details.

### Common Models

| Model ID | Provider |
|----------|----------|
| `claude-sonnet-4-6` / `claude-opus-4-8` / `claude-opus-4-7` / `claude-haiku-4-5-20251001` | Anthropic |
| `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.3-codex` | OpenAI |
| `deepseek/deepseek-v4-pro` / `deepseek/deepseek-v4-flash` | DeepSeek |
| `moonshotai/Kimi-K2.6` / `moonshotai/Kimi-K2.5` | Kimi |
| `zai-org/GLM-5.1` / `zai-org/GLM-5` | GLM |
| `MiniMaxAI/MiniMax-M3` / `MiniMaxAI/MiniMax-M2.7` / `MiniMaxAI/MiniMax-M2.5` | MiniMax |
| `Qwen/Qwen3.7-Max` / `Qwen/Qwen3.6-Max-Preview` / `Qwen/Qwen3.6-Plus` | Qwen |
| `stepfun/Step-3.7-Flash` / `stepfun/Step-3.5-Flash` | Step |
| `xiaomi/mimo-v2.5-pro` / `xiaomi/mimo-v2.5` | Xiaomi (**image input supported**) |
| `google/gemini-3.5-flash` / `google/gemini-3.1-flash-lite` | Gemini |

> ⚠️ Some models (e.g. `deepseek-v4-flash`, `claude-sonnet-4-6`) do not support image input. Use `xiaomi/mimo-v2.5`, `Kimi-K2.5`, or other vision models for multimodal.

## Integration Examples

### Python (OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    api_key="user_xxxxxxxxx",
    base_url="http://127.0.0.1:3050/v1",
)

response = client.chat.completions.create(
    model="deepseek/deepseek-v4-flash",
    messages=[{"role": "user", "content": "hello"}],
    stream=True,
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

### cURL
```bash
curl http://127.0.0.1:3050/v1/chat/completions \
  -H "Authorization: Bearer user_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-v4-flash",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'
```

### Cursor
Add a Custom Provider in Cursor settings:
- **API Base URL**: `http://127.0.0.1:3050/v1`
- **API Key**: `user_xxxxxxxxx`
- **Model**: Choose from the model list

### Anthropic (Python SDK)
```python
import anthropic

client = anthropic.Anthropic(
    api_key="user_xxxxxxxxx",
    base_url="http://127.0.0.1:3050",
)
message = client.messages.create(
    model="deepseek/deepseek-v4-flash",
    max_tokens=1000,
    system="You are helpful.",
    messages=[{"role": "user", "content": "hello"}],
)
print(message.content[0].text)
```

The Anthropic SDK authenticates via the `x-api-key` header — supported by the proxy natively (no `Authorization` header needed).

### OpenCode
```json
{
  "provider": "openai-compatible",
  "baseUrl": "http://127.0.0.1:3050/v1",
  "apiKey": "user_xxxxxxxxx"
}
```

## Anti-Detection

Based on analysis of official CLI traffic (version auto-fetched from npm registry):

| Mechanism | Implementation |
|-----------|---------------|
| **Device Fingerprint** | `POST /alpha/fingerprint/record` before first request per key; random fingerprint pool (15 CPUs, global timezones), SHA-256 hashed, per-key binding, refreshed every 8h + 2h jitter |
| **Lifecycle Events** | `POST /alpha/lifecycle-events` (`cli_session_exists`) sent in parallel with fingerprint on session init |
| **Per-Key Session** | One session per API key, 12h expiry + 1h random jitter |
| **Version** | `x-command-code-version` auto-fetched from npm registry (24h refresh) |
| **CLI Envelope** | config/memory/taste/skills/permissionMode/params |
| **OpenTelemetry** | `traceparent` (W3C Trace Context) |
| **Environment** | `x-cli-environment: production`, `x-co-flag: "false"`, `x-taste-learning: "false"` |
| **Project Slug** | `x-project-slug` generated from session ID (CLI-compatible format) |
| **Reasoning Effort** | `reasoning_effort` pass-through (low/medium/high/max) |
| **Key Validation** | Regex `user_[a-zA-Z0-9_-]+` on `Authorization: Bearer` or `x-api-key`, auto-cleans extra paths/prefixes, rejects `sk-xxx` format |
| **Stream Timeout** | 30s streaming / 90s non-streaming → 429 with SDK auto-retry |
| **Consecutive Timeout** | 3 consecutive timeouts before "reduce context" hint |
| **Zero-Output Guard** | outputTokens=0 → 429 `rate_limit_error` (SDK auto-retry, anti false billing) |
| **Upstream Abort** | `AbortController` on client disconnect + all error paths |
| **Privacy Logging** | No API key fragments, no error bodies, no stack traces in logs |

## Protocol Details

### CC API Request Structure

```json
{
  "config": {
    "workingDir": "C:\\project",
    "date": "2026-06-07",
    "environment": "win32-x64, Node.js v24.16.0",
    "structure": [],
    "isGitRepo": false,
    "currentBranch": "",
    "mainBranch": "",
    "gitStatus": "",
    "recentCommits": []
  },
  "memory": null,
  "taste": null,
  "skills": "",
  "permissionMode": "standard",
  "params": {
    "model": "deepseek/deepseek-v4-flash",
    "messages": [...],
    "max_tokens": 64000,
    "stream": true,
    "reasoning_effort": "max"
  }
}
```

Conditional fields: `system` (extracted from `system` messages), `temperature`, `reasoning_effort`, `tools` (mapped to CC `input_schema` format).

### CC API Image Message Format

The CLI sends images in this format:

```json
{
  "role": "user",
  "content": [
    { "type": "image", "image": "data:image/jpeg;base64,..." },
    { "type": "text", "text": "What does this image say?" }
  ]
}
```

The proxy receives OpenAI `image_url` format and converts it to the above CC format transparently.

## Docker Deployment

### Pull from GHCR

Pre-built multi-arch images (`linux/amd64` + `linux/arm64`) are published to the GitHub Container Registry automatically on every `v*` tag via GitHub Actions:

```bash
docker pull ghcr.io/maxeaglet/commandcode-proxy:latest
docker run -d --name cc-proxy -p 3050:3050 \
  -e PORT=3050 \
  -e CC_PUBLIC_URL=https://console.example.com \
  -v cc-proxy-runtime:/root/.config/commandcode-proxy \
  -v cc-proxy-auth:/root/.commandcode \
  ghcr.io/maxeaglet/commandcode-proxy:latest
```

The `latest` tag is updated on each release. The image is public — no login required to pull.

### Quick Start (docker compose)

```bash
docker compose build
docker compose up -d
```

The proxy will listen on `http://0.0.0.0:3050` and provide `/console`. Direct access through the server's public address automatically generates a remote callback. For a reverse proxy or fixed domain, set `CC_PUBLIC_URL`:

```bash
CC_PUBLIC_URL=https://console.example.com docker compose up -d --build
```

Set `PROXY_PORT` to customize the host port:

```bash
PROXY_PORT=13050 docker compose up -d
```

### Build from Source

```bash
npm --prefix web ci --ignore-scripts
npm --prefix web run build
docker build -t commandcode-proxy:latest .
docker run -d -p 3050:3050 -e PORT=3050 commandcode-proxy:latest
```

### Multi-Architecture Build

```bash
npm run docker:build:multi
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3050` | Container listen port |
| `PROXY_PORT` | `3050` | Host port (compose only) |
| `CC_PUBLIC_URL` | empty | Public origin for browser auth callbacks, e.g. `https://console.example.com` |
| `CC_MAX_BODY_MB` | `100` | Max request body size in MB; oversized requests are rejected with `HTTP 413` |

For container deployments, mount `/root/.config/commandcode-proxy` and `/root/.commandcode` so gateway keys, model settings, multiple account tokens, and cached quotas survive container recreation.

## Disclaimer

This project is for **educational and research purposes** only.

This repository is a continuation of the upstream [`MAXeaglet/commandcode-proxy`](https://github.com/MAXeaglet/commandcode-proxy) project under its MIT License. Keep the repository's `LICENSE` file and its `Copyright (c) 2026 MAXeaglet` notice when redistributing; the Web console, multi-account token storage and switching, quota display, runtime management, and deployment adaptations added here are released under the same license. Command Code and its services belong to their respective rights holders; this is not official Command Code software.

- **Unofficial**: This project is not affiliated with Command Code in any way; the Web console is an original management interface added by this repository.
- **Personal Use**: Users assume all responsibility. Please comply with the [Command Code Terms of Service](https://commandcode.ai/tos).
- **API Key**: This project does not collect, upload, or leak your credentials. Gateway keys are used only for local proxy authentication; the upstream account token is sent only to the configured Command Code API address. Protect runtime files yourself; full keys are not written to logs.
- **Compliance**: The protocol is based on passive observation of local CLI network traffic. No unauthorized access, cracking, or tampering of the server has been performed.
- **Account Risk**: Keep usage frequency consistent with normal CLI usage. Extremely high concurrent calls may trigger risk controls.

---

## Development

```bash
npm --prefix web run dev
npm run dev
```
