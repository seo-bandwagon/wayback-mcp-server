# Wayback MCP Server

MCP server for the Internet Archive's Wayback Machine. Enables AI assistants like Claude to analyze historical webpage snapshots for SEO analysis and content change tracking.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Archive Availability Check** - Verify if URLs are archived (with automatic www/non-www variant checking)
- **Snapshot Listing** - Browse all archived versions with filtering
- **Content Extraction** - Fetch snapshots with SEO metadata extraction
- **Snapshot Comparison** - Compare two versions to identify changes
- **Bulk Operations** - Check multiple URLs efficiently
- **Changes Timeline** - Visualize content evolution over time
- **SEO Impact Analysis** - Score changes for SEO impact
- **Site-Wide URL Discovery** - Get all archived URLs for a domain

## Installation

### Option 1: OpenClaw Skill (Recommended)

If you're using [OpenClaw](https://github.com/openclaw/openclaw), the Wayback skill is available out of the box:

```bash
# The skill is included in the workspace
# Just use it - no installation needed!
```

**Example commands:**
```bash
# Check if a URL is archived
node ~/.openclaw/workspace/skills/wayback/scripts/wayback.js check "https://example.com"

# List snapshots
node ~/.openclaw/workspace/skills/wayback/scripts/wayback.js snapshots "https://example.com" --limit 10

# Compare two points in time
node ~/.openclaw/workspace/skills/wayback/scripts/wayback.js compare "https://example.com" \
  --from 20230101000000 --to 20231231000000
```

### Option 2: Claude Desktop (MCP Server)

Add to your Claude Desktop configuration:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wayback": {
      "command": "node",
      "args": ["/path/to/wayback-mcp-server/dist/index.js"]
    }
  }
}
```

### Option 3: Run from Source

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
| `wayback_get_site_urls` | Get all archived URLs for a domain |

## Example Usage

### With Claude/OpenClaw

Once configured, you can ask:

- "Check if example.com is in the Wayback Machine"
- "Show me all snapshots of example.com from 2023"
- "Compare the homepage from January vs December 2023"
- "What SEO changes happened on this page between these dates?"
- "What URLs have been archived for example.com?"
- "Find all archived blog posts on moz.com"

### CLI Examples

```bash
# Check availability
node wayback.js check "https://seobandwagon.com"
# Output: available: true, timestamp: 20251209071137

# Get snapshots from 2023
node wayback.js snapshots "https://moz.com" --year 2023 --limit 10

# Get content with SEO metadata
node wayback.js content "https://example.com" --latest

# Compare two versions
node wayback.js compare "https://example.com" --from 20230101000000 --to 20231201000000

# Get all archived URLs for a domain
node wayback.js urls "example.com" --limit 50

# Bulk check multiple URLs
node wayback.js bulk-check "https://a.com" "https://b.com" "https://c.com"
```

## Use Cases

### SEO Analysis
- Track competitor changes over time
- Analyze title/description evolution
- Find removed content
- Monitor redirect implementations

### Content Research
- Find original content before redesigns
- Verify historical claims
- Track pricing changes
- Research topic evolution

### Technical SEO
- Diagnose traffic drops (before/after comparison)
- Find what content used to exist at broken URLs
- Analyze site structure changes

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

## Related Projects

- [OpenClaw](https://github.com/openclaw/openclaw) - AI assistant framework with native Wayback skill
- [Model Context Protocol](https://modelcontextprotocol.io) - The protocol this server implements
- [Internet Archive](https://archive.org) - Data source for all historical snapshots

## License

MIT - see [LICENSE](LICENSE)

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

---

Built by [SEO Bandwagon](https://seobandwagon.com) | Data provided by the [Internet Archive](https://archive.org)
