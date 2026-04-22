import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;

      stream.off('data', onData);
      stream.off('error', reject);

      const line = buffer.slice(0, newlineIndex);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    }

    stream.on('data', onData);
    stream.on('error', reject);
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const calls = [];
const server = http.createServer(async (request, response) => {
  const body = await readBody(request);
  const payload = JSON.parse(body);
  calls.push({
    method: payload.method,
    sessionId: request.headers['mcp-session-id']
  });

  response.setHeader('content-type', 'application/json');

  if (payload.method === 'initialize') {
    response.setHeader('mcp-session-id', 'test-session');
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'mock-paper', version: '0.0.0' }
        }
      })
    );
    return;
  }

  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: { ok: true }
    })
  );
});

await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});

const { port } = server.address();
const child = spawn(process.execPath, ['bin/paper-mcp.js'], {
  env: {
    ...process.env,
    PAPER_MCP_URL: `http://127.0.0.1:${port}/mcp`
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

try {
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    })}\n`
  );

  const initializeResponse = await readJsonLine(child.stdout);
  assert.equal(initializeResponse.id, 1);
  assert.equal(initializeResponse.result.serverInfo.name, 'paper-mcp');

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    })}\n`
  );

  const toolsListResponse = await readJsonLine(child.stdout);
  assert.equal(toolsListResponse.id, 2);
  assert.ok(
    toolsListResponse.result.tools.some((tool) => tool.name === 'paper_connection_status')
  );
  assert.ok(toolsListResponse.result.tools.some((tool) => tool.name === 'get_selection'));

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_selection',
        arguments: {}
      }
    })}\n`
  );

  const callResponse = await readJsonLine(child.stdout);
  assert.equal(callResponse.id, 3);
  assert.deepEqual(callResponse.result, { ok: true });

  assert.deepEqual(calls, [
    { method: 'initialize', sessionId: undefined },
    { method: 'notifications/initialized', sessionId: 'test-session' },
    { method: 'tools/call', sessionId: 'test-session' }
  ]);
} finally {
  child.kill('SIGTERM');
  server.close();
}
