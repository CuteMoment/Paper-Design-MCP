#!/usr/bin/env node

import { createInterface } from 'node:readline';

const DEFAULT_PAPER_MCP_URL = 'http://127.0.0.1:29979/mcp';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const paperMcpUrl = process.env.PAPER_MCP_URL || DEFAULT_PAPER_MCP_URL;

let nextPaperRequestId = 1;
let paperInitialized = false;
let paperSessionId;
let closed = false;
let processing = Promise.resolve();

const paperTools = [
  {
    name: 'paper_connection_status',
    description: 'Check whether Paper Desktop MCP is reachable on this machine.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_basic_info',
    description: 'Get the current Paper file name, page name, node count, and artboards.'
  },
  {
    name: 'get_selection',
    description: 'Get details about the currently selected Paper nodes.'
  },
  {
    name: 'get_node_info',
    description: 'Get Paper node details by node ID.',
    inputSchema: objectSchema({
      nodeId: stringSchema('Paper node ID.')
    }, ['nodeId'])
  },
  {
    name: 'get_children',
    description: 'Get direct children of a Paper node.',
    inputSchema: objectSchema({
      nodeId: stringSchema('Paper node ID.')
    }, ['nodeId'])
  },
  {
    name: 'get_tree_summary',
    description: 'Get a compact hierarchy summary for a Paper node subtree.',
    inputSchema: objectSchema({
      nodeId: stringSchema('Paper node ID. Omit only if Paper supports defaulting to the current page or selection.'),
      depth: numberSchema('Optional maximum depth.')
    })
  },
  {
    name: 'get_screenshot',
    description: 'Get a screenshot of a Paper node as base64 image data.',
    inputSchema: objectSchema({
      nodeId: stringSchema('Paper node ID.'),
      scale: enumSchema([1, 2], 'Optional screenshot scale.')
    }, ['nodeId'])
  },
  {
    name: 'get_jsx',
    description: 'Get JSX for a Paper node and its descendants.',
    inputSchema: objectSchema({
      nodeId: stringSchema('Paper node ID.'),
      format: enumSchema(['tailwind', 'inline-styles'], 'Optional output style format.')
    }, ['nodeId'])
  },
  {
    name: 'get_computed_styles',
    description: 'Get computed CSS styles for one or more Paper nodes.',
    inputSchema: objectSchema({
      nodeIds: arraySchema(stringSchema('Paper node ID.'), 'Paper node IDs.')
    }, ['nodeIds'])
  },
  {
    name: 'get_fill_image',
    description: 'Get image data from a Paper node that has an image fill.',
    inputSchema: objectSchema({
      nodeId: stringSchema('Paper node ID.')
    }, ['nodeId'])
  },
  {
    name: 'get_font_family_info',
    description: 'Look up whether a font family is available and inspect its weights and styles.',
    inputSchema: objectSchema({
      fontFamily: stringSchema('Font family name.')
    }, ['fontFamily'])
  },
  {
    name: 'get_guide',
    description: 'Retrieve a Paper guided workflow by topic.',
    inputSchema: objectSchema({
      topic: stringSchema('Guide topic, for example figma-import.')
    }, ['topic'])
  },
  {
    name: 'find_placement',
    description: 'Find a suggested x/y location to place a new artboard without overlap.',
    inputSchema: objectSchema({
      width: numberSchema('Desired width.'),
      height: numberSchema('Desired height.')
    })
  },
  {
    name: 'create_artboard',
    description: 'Create a new Paper artboard.',
    inputSchema: objectSchema({
      name: stringSchema('Artboard name.'),
      width: numberSchema('Artboard width.'),
      height: numberSchema('Artboard height.'),
      x: numberSchema('Optional x position.'),
      y: numberSchema('Optional y position.'),
      styles: objectSchema({}, [], 'Optional CSS-like styles.')
    })
  },
  {
    name: 'write_html',
    description: 'Parse HTML and add or replace Paper nodes.',
    inputSchema: objectSchema({
      html: stringSchema('HTML to write into Paper.'),
      parentId: stringSchema('Target parent node ID.'),
      mode: enumSchema(['insert-children', 'replace'], 'Write mode.')
    }, ['html'])
  },
  {
    name: 'set_text_content',
    description: 'Set text content for one or more Paper text nodes.',
    inputSchema: objectSchema({
      updates: arraySchema(objectSchema({
        nodeId: stringSchema('Text node ID.'),
        text: stringSchema('New text content.')
      }, ['nodeId', 'text']), 'Text updates.')
    }, ['updates'])
  },
  {
    name: 'rename_nodes',
    description: 'Rename one or more Paper nodes.',
    inputSchema: objectSchema({
      updates: arraySchema(objectSchema({
        nodeId: stringSchema('Node ID.'),
        name: stringSchema('New layer name.')
      }, ['nodeId', 'name']), 'Rename updates.')
    }, ['updates'])
  },
  {
    name: 'duplicate_nodes',
    description: 'Deep-clone one or more Paper nodes.',
    inputSchema: objectSchema({
      nodeIds: arraySchema(stringSchema('Node ID.'), 'Node IDs to duplicate.')
    }, ['nodeIds'])
  },
  {
    name: 'update_styles',
    description: 'Update CSS styles on one or more Paper nodes.',
    inputSchema: objectSchema({
      updates: arraySchema(objectSchema({
        nodeId: stringSchema('Node ID.'),
        styles: objectSchema({}, [], 'CSS-like style object.')
      }, ['nodeId', 'styles']), 'Style updates.')
    }, ['updates'])
  },
  {
    name: 'delete_nodes',
    description: 'Delete one or more Paper nodes and their descendants.',
    inputSchema: objectSchema({
      nodeIds: arraySchema(stringSchema('Node ID.'), 'Node IDs to delete.')
    }, ['nodeIds'])
  },
  {
    name: 'start_working_on_nodes',
    description: 'Mark Paper artboards or nodes as being worked on.',
    inputSchema: objectSchema({
      nodeIds: arraySchema(stringSchema('Node ID.'), 'Node IDs.')
    }, ['nodeIds'])
  },
  {
    name: 'finish_working_on_nodes',
    description: 'Clear the working indicator from Paper artboards or nodes.',
    inputSchema: objectSchema({
      nodeIds: arraySchema(stringSchema('Node ID.'), 'Node IDs.')
    }, ['nodeIds'])
  }
].map((tool) => ({
  inputSchema: objectSchema({}),
  ...tool
}));

const prompts = [
  {
    name: 'design-to-code',
    description: 'Use the current Paper selection as context to implement production UI code.',
    arguments: [
      {
        name: 'framework',
        description: 'Target UI framework, such as React, Vue, or HTML.',
        required: false
      }
    ]
  },
  {
    name: 'code-to-design',
    description: 'Create or update a Paper design from existing app code, tokens, and components.'
  }
];

function objectSchema(properties = {}, required = [], description) {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    ...(required.length > 0 ? { required } : {})
  };
}

function stringSchema(description) {
  return {
    type: 'string',
    ...(description ? { description } : {})
  };
}

function numberSchema(description) {
  return {
    type: 'number',
    ...(description ? { description } : {})
  };
}

function enumSchema(values, description) {
  return {
    enum: values,
    ...(description ? { description } : {})
  };
}

function arraySchema(items, description) {
  return {
    type: 'array',
    ...(description ? { description } : {}),
    items
  };
}

function log(message) {
  process.stderr.write(`[paper-design-mcp] ${message}\n`);
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function makeErrorResponse(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function textContent(text) {
  return {
    content: [
      {
        type: 'text',
        text
      }
    ]
  };
}

async function readSseMessages(body) {
  const messages = [];
  const events = body.split(/\r?\n\r?\n/);

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) continue;

    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') continue;

    try {
      messages.push(JSON.parse(data));
    } catch (error) {
      log(`ignored non-JSON SSE data: ${error.message}`);
    }
  }

  return messages;
}

async function parseHttpResponse(response) {
  if (response.status === 202 || response.status === 204) return [];

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text.trim()) return [];

  if (contentType.includes('text/event-stream')) {
    return readSseMessages(text);
  }

  try {
    const payload = JSON.parse(text);
    return Array.isArray(payload) ? payload : [payload];
  } catch (error) {
    throw new Error(`Paper MCP returned invalid JSON: ${error.message}`);
  }
}

async function sendToPaper(message) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json'
  };

  if (paperSessionId) {
    headers['Mcp-Session-Id'] = paperSessionId;
  }

  const response = await fetch(paperMcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(message)
  });

  const nextSessionId = response.headers.get('mcp-session-id');
  if (nextSessionId) {
    paperSessionId = nextSessionId;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Paper MCP HTTP ${response.status}: ${text || response.statusText}`);
  }

  return parseHttpResponse(response);
}

async function requestPaper(method, params = {}) {
  const id = nextPaperRequestId++;
  const responses = await sendToPaper({
    jsonrpc: '2.0',
    id,
    method,
    params
  });

  const response = responses.find((item) => item.id === id) || responses[0];
  if (!response) return undefined;
  if (response.error) {
    throw new Error(response.error.message || `Paper MCP ${method} failed`);
  }
  return response.result;
}

async function ensurePaperInitialized() {
  if (paperInitialized) return;

  await requestPaper('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: 'paper-design-mcp',
      version: '0.1.0'
    }
  });

  await sendToPaper({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }).catch(() => []);

  paperInitialized = true;
}

async function callPaperTool(name, args) {
  await ensurePaperInitialized();
  return requestPaper('tools/call', {
    name,
    arguments: args || {}
  });
}

async function checkPaperConnection() {
  const startedAt = Date.now();
  try {
    await ensurePaperInitialized();
    return textContent(
      `Paper Desktop MCP is reachable at ${paperMcpUrl}. Latency: ${Date.now() - startedAt}ms.`
    );
  } catch (error) {
    return textContent(
      `Paper Desktop MCP is not reachable at ${paperMcpUrl}. Open Paper Desktop, open a Paper file, then retry. Error: ${error.message}`
    );
  }
}

function getPrompt(name, args = {}) {
  if (name === 'design-to-code') {
    const framework = args.framework || 'the existing project framework';
    return {
      description: 'Implement UI from the current Paper selection.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Inspect the current Paper selection, summarize the design structure, then implement it using ${framework}. Preserve the app's existing conventions and ask before destructive Paper edits.`
          }
        }
      ]
    };
  }

  if (name === 'code-to-design') {
    return {
      description: 'Create or update a Paper design from app code.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Inspect the app code, identify reusable components, tokens, and layout patterns, then create or update the matching Paper design. Ask before replacing existing Paper nodes.'
          }
        }
      ]
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
}

async function handleRequest(message) {
  switch (message.method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          prompts: {},
          resources: {}
        },
        serverInfo: {
          name: 'paper-design-mcp',
          version: '0.1.0'
        }
      };
    case 'tools/list':
      return { tools: paperTools };
    case 'tools/call': {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      if (name === 'paper_connection_status') {
        return checkPaperConnection();
      }
      return callPaperTool(name, args);
    }
    case 'prompts/list':
      return { prompts };
    case 'prompts/get':
      return getPrompt(message.params?.name, message.params?.arguments);
    case 'resources/list':
      return { resources: [] };
    default:
      throw new Error(`Unsupported method: ${message.method}`);
  }
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed || closed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    log(`ignored invalid JSON from stdin: ${error.message}`);
    return;
  }

  if (message.id === undefined) {
    return;
  }

  try {
    const result = await handleRequest(message);
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result
    });
  } catch (error) {
    writeMessage(makeErrorResponse(message.id, -32000, error.message));
  }
}

function shutdown() {
  if (closed) return;
  closed = true;
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  processing = processing.then(() => handleLine(line));
  processing.catch((error) => {
    log(`unexpected processing error: ${error.message}`);
  });
});

rl.on('close', shutdown);

log(`ready; forwarding Paper tool calls to ${paperMcpUrl}`);
