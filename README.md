# Paper MCP

A LobeHub-friendly MCP wrapper for Paper Desktop's local MCP server.

Paper Desktop already exposes a Streamable HTTP MCP endpoint at:

```text
http://127.0.0.1:29979/mcp
```

Many clients and marketplaces, including LobeHub/LobeChat entries, are easiest to distribute as a local stdio command. This package exposes a stable stdio MCP server and forwards Paper design tool calls to Paper's local HTTP MCP endpoint.

It intentionally exposes `tools/list` without requiring Paper Desktop to be running, so marketplace checks can inspect the server. Actual design read/write tools require Paper Desktop to be open.

## Requirements

- Node.js 18 or newer
- Paper Desktop running locally
- A Paper file open in Paper Desktop

## LobeHub / LobeChat Install Config

Use this JSON in LobeChat Desktop's custom plugin quick import:

```json
{
  "mcpServers": {
    "paper-mcp": {
      "command": "npx",
      "args": ["-y", "paper-mcp@latest"]
    }
  }
}
```

If Paper Desktop uses a custom MCP URL:

```json
{
  "mcpServers": {
    "paper-mcp": {
      "command": "npx",
      "args": ["-y", "paper-mcp@latest"],
      "env": {
        "PAPER_MCP_URL": "http://127.0.0.1:29979/mcp"
      }
    }
  }
}
```

## Local Development

```bash
npm run check
npm test
npm start
```

The MCP server reads JSON-RPC messages from stdin, exposes Paper-oriented tools and prompts, forwards tool calls to Paper Desktop, and writes JSON-RPC responses to stdout.

## Tools

This MCP server exposes:

- `paper_connection_status`
- `get_basic_info`
- `get_selection`
- `get_node_info`
- `get_children`
- `get_tree_summary`
- `get_screenshot`
- `get_jsx`
- `get_computed_styles`
- `get_fill_image`
- `get_font_family_info`
- `get_guide`
- `find_placement`
- `create_artboard`
- `write_html`
- `set_text_content`
- `rename_nodes`
- `duplicate_nodes`
- `update_styles`
- `delete_nodes`
- `start_working_on_nodes`
- `finish_working_on_nodes`

The Paper tools mirror Paper Desktop's documented MCP capabilities and are forwarded to the local Paper MCP server at runtime.

## Prompts

- `design-to-code`: inspect the current Paper selection and implement production UI code.
- `code-to-design`: inspect app code and create or update a matching Paper design.

## Direct HTTP Config

Clients that support Streamable HTTP directly can skip this package and connect to Paper Desktop:

```json
{
  "mcpServers": {
    "paper": {
      "transportType": "streamable-http",
      "url": "http://127.0.0.1:29979/mcp"
    }
  }
}
```

## Safety

Paper MCP can read and write the currently open Paper document. Review tool calls before allowing write actions such as editing text, updating styles, creating nodes, or deleting nodes.

## LobeHub Submission Copy

Name:

```text
Paper MCP
```

Description:

```text
A local MCP bridge that lets LobeChat and other stdio MCP clients connect to Paper Desktop's built-in MCP server for reading and editing the current Paper design file.
```

Category:

```text
Developer Tools
```

Service type:

```text
Local Service
```

Install:

```json
{
  "mcpServers": {
    "paper-mcp": {
      "command": "npx",
      "args": ["-y", "paper-mcp@latest"]
    }
  }
}
```
