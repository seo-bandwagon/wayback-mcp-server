# Wayback MCP Server

MCP server for the Internet Archive's Wayback Machine. Enables AI assistants like Claude to analyze historical webpage snapshots for SEO analysis and content change tracking.

[![npm version](https://img.shields.io/npm/v/wayback-mcp-server.svg)](https://www.npmjs.com/package/wayback-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Archive Availability Check** - Verify if URLs are archived
- **Snapshot Listing** - Browse all archived versions with filtering
- **Content Extraction** - Fetch snapshots with SEO metadata extraction
- **Snapshot Comparison** - Compare two versions to identify changes
- **Bulk Operations** - Check multiple URLs efficiently
- **Changes Timeline** - Visualize content evolution over time
- **SEO Impact Analysis** - Score changes for SEO impact

## Quick Start

### Install via npm

```bash
npm install -g wayback-mcp-server
```

### Configure Claude Desktop

Add to your Claude Desktop configuration:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wayback": {
      "command": "wayback-mcp"
    }
  }
}
```

### Or run from source

```bash
git clone https://github.com/seo-bandwagon/wayback-mcp-server.git
cd wayback-mcp-server
npm install
npm run build
npm start
```

## Available Tools

| Tool | Description |
|------|-------------|
| `wayback_check_availability` | Check if a URL is archived |
| `wayback_get_snapshots` | List all snapshots with filtering |
| `wayback_get_snapshot_content` | Fetch content with metadata extraction |
| `wayback_compare_snapshots` | Compare two snapshots |
| `wayback_bulk_check` | Check multiple URLs (max 50) |
| `wayback_get_changes_timeline` | Timeline of content changes |
| `wayback_analyze_changes` | SEO-focused change analysis |

## Example Usage

Once configured, you can ask Claude:

- "Check if example.com is in the Wayback Machine"
- "Show me all snapshots of example.com from 2023"
- "Compare the homepage from January vs December 2023"
- "What SEO changes happened on this page between these dates?"

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `WAYBACK_CACHE_PATH` | `~/.wayback-mcp/cache.json` | Cache file location |
| `WAYBACK_CACHE_TTL` | `3600` | Default cache TTL (seconds) |
| `WAYBACK_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

## Rate Limiting

The server implements conservative rate limiting to respect archive.org:

- Availability checks: 15/minute
- CDX queries: 10/minute
- Content fetches: 5/minute

## Requirements

- Node.js >= 18.0.0

## License

MIT - see [LICENSE](LICENSE)

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Acknowledgments

Built on the [Model Context Protocol](https://modelcontextprotocol.io) SDK.
Data provided by the [Internet Archive](https://archive.org).
