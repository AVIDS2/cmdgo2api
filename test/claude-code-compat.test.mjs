import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function waitForHealth(port, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The proxy is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Proxy did not become healthy: ${output.join('')}`);
}

test('Claude Code thinking and tool continuations reach Command Code', async () => {
  let generatedRequest;
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/alpha/generate') {
        generatedRequest = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end([
          JSON.stringify({ type: 'reasoning-delta', text: 'thinking' }),
          JSON.stringify({ type: 'text-delta', text: 'done' }),
          JSON.stringify({ type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 2, outputTokens: 2 } }),
          '',
        ].join('\n'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  const upstreamPort = await listen(upstream);
  const proxyPortServer = http.createServer();
  const proxyPort = await listen(proxyPortServer);
  await new Promise((resolve) => proxyPortServer.close(resolve));

  const output = [];
  const gatewayKey = 'test-gateway-key';
  const proxy = spawn(process.execPath, ['proxy.mjs'], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(proxyPort),
      HOST: '127.0.0.1',
      CC_API_BASE: `http://127.0.0.1:${upstreamPort}`,
      CC_USE_PROVIDER_MODELS: 'false',
      CC_API_KEY: 'user_test',
      GATEWAY_API_KEYS_JSON_B64: Buffer.from(JSON.stringify([gatewayKey])).toString('base64url'),
      CC_EMPTY_SYSTEM_PLACEHOLDER: 'false',
      CC_STREAM_IDLE_MS: '5000',
      CC_NONSTREAM_IDLE_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proxy.stdout.on('data', (chunk) => output.push(chunk.toString()));
  proxy.stderr.on('data', (chunk) => output.push(chunk.toString()));

  try {
    await waitForHealth(proxyPort, output);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': gatewayKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'meta/muse-spark-1.3-contributor',
        max_tokens: 1000,
        stream: true,
        system: [{ type: 'text', text: 'system' }],
        messages: [
          { role: 'user', content: 'start' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'prior reasoning', signature: 'signature' },
              { type: 'text', text: 'use tool' },
              { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'x' } },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' }],
          },
        ],
        tools: [{ name: 'read', input_schema: { type: 'object', properties: {} } }],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      }),
    });

    assert.equal(response.status, 200);
    await response.text();
    assert.equal(generatedRequest.params.reasoning_effort, 'high');
    assert.equal(generatedRequest.params.parallel_tool_calls, false);

    const assistant = generatedRequest.params.messages.find((message) => message.role === 'assistant');
    assert.equal(assistant.reasoning_content, 'prior reasoning');
    assert.equal(assistant.content[0].text, 'use tool');
    assert.equal(assistant.content[1].type, 'tool-call');

    const tool = generatedRequest.params.messages.find((message) => message.role === 'tool');
    assert.equal(tool.content[0].type, 'tool-result');
    assert.equal(tool.content[0].toolCallId, 'toolu_1');
  } finally {
    proxy.kill();
    await once(proxy, 'exit').catch(() => {});
    await new Promise((resolve) => upstream.close(resolve));
  }
});
