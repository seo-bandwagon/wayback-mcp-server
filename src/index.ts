#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { WaybackClient } from './api/client.js';
import { createTools } from './tools/index.js';
import { getConfig } from './utils/config.js';

async function main() {
  const config = getConfig();

  // Initialize client
  const client = new WaybackClient(config);

  try {
    await client.initialize();
  } catch (error) {
    console.error('Failed to initialize Wayback client:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Create tools
  const { tools, handlers } = createTools(client);

  // Create MCP server
  const server = new Server(
    {
      name: 'wayback-mcp-server',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = handlers.get(name);
    if (!handler) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` } })
          }
        ]
      };
    }

    const result = await handler(args || {});
    return {
      content: [
        {
          type: 'text',
          text: result
        }
      ]
    };
  });

  // Handle cleanup
  process.on('SIGINT', async () => {
    await client.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await client.close();
    process.exit(0);
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Wayback MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
