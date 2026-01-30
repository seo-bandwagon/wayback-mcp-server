# Wayback MCP Server

MCP (Model Context Protocol) server for the Internet Archive's Wayback Machine. Enables Claude to analyze historical webpage snapshots for SEO analysis and content change tracking.

## Table of Contents

- [Project Overview](#project-overview)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [MCP Tools](#mcp-tools)
- [Configuration](#configuration)
- [Code Patterns](#code-patterns)
- [MCP Client Setup](#mcp-client-setup)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)
- [External APIs](#external-apis)
- [Dependencies](#dependencies)
- [Production Considerations](#production-considerations)

## Project Overview

| Property | Value |
|----------|-------|
| Type | MCP Server (stdio transport) |
| Language | TypeScript (ES modules) |
| Runtime | Node.js >= 18 |
| Purpose | Historical webpage analysis via Wayback Machine APIs |

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run server
npm start

# Watch mode for development
npm run dev
```

## Architecture

### File Structure

```
src/
├── index.ts              # Entry point, MCP server setup
├── tools/index.ts        # Tool definitions and handlers
├── types/index.ts        # Zod schemas and TypeScript types
├── api/
│   ├── client.ts         # HTTP client with retry/rate limiting
│   ├── availability.ts   # Availability API wrapper
│   ├── cdx.ts            # CDX Server API (snapshots listing)
│   ├── snapshots.ts      # Snapshot content fetching
│   └── diff.ts           # Snapshot comparison service
├── cache/cache.ts        # JSON file-based cache
└── utils/
    ├── config.ts         # Environment config
    ├── rate-limiter.ts   # Request rate limiting
    ├── html-parser.ts    # Cheerio-based HTML parsing
    ├── date.ts           # Timestamp utilities
    └── errors.ts         # Error handling
```

### Request Flow

1. MCP client sends tool request via stdio
2. Server routes to handler in `tools/index.ts`
3. Input validated against Zod schema in `types/index.ts`
4. Rate limiter checks endpoint quota
5. Cache checked for existing data
6. If cache miss, API request made via `api/client.ts`
7. Response parsed, cached, and returned as JSON

## MCP Tools

### 1. `wayback_check_availability`

Check if a URL is archived and get the closest snapshot.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to check |
| `timestamp` | No | Target date (YYYYMMDDhhmmss or YYYY-MM-DD) |

**Example Output:**
```json
{
  "url": "https://example.com",
  "isArchived": true,
  "closestSnapshot": {
    "url": "https://web.archive.org/web/20231215143022/https://example.com",
    "timestamp": "20231215143022",
    "formattedDate": "2023-12-15",
    "status": "200"
  },
  "archiveOrgUrl": "https://web.archive.org/web/*/https://example.com"
}
```

### 2. `wayback_get_snapshots`

List all archived snapshots with filtering options.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to search |
| `matchType` | No | exact, prefix, host, domain |
| `from` | No | Start date |
| `to` | No | End date |
| `statusFilter` | No | 200, 2xx, 3xx, 4xx, 5xx, all |
| `collapse` | No | none, daily, monthly, yearly, digest |
| `limit` | No | Max results to return |

### 3. `wayback_get_snapshot_content`

Fetch snapshot content with SEO metadata extraction.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL of snapshot |
| `timestamp` | Yes | Snapshot timestamp |
| `extractMetadata` | No | Extract SEO metadata (default: true) |
| `includeRawHtml` | No | Include raw HTML (default: false) |
| `maxContentLength` | No | Max content chars (default: 50000) |

**Extracted Metadata:**
- Title, meta description, keywords
- Canonical URL, robots directives
- H1 and H2 headings
- Internal/external links
- Open Graph tags
- JSON-LD structured data
- Word count

### 4. `wayback_compare_snapshots`

Compare two snapshots to identify changes.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to compare |
| `timestamp1` | Yes | First snapshot timestamp |
| `timestamp2` | Yes | Second snapshot timestamp |
| `compareElements` | No | title, description, headings, content, links, structure, all |
| `showDiff` | No | Show text diff (default: false) |

### 5. `wayback_bulk_check`

Check multiple URLs for archive availability.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `urls` | Yes | Array of URLs (max 50) |
| `timestamp` | No | Target date for all URLs |
| `includeSnapshotCount` | No | Include total snapshot count per URL |

### 6. `wayback_get_changes_timeline`

Get timeline of content changes for a URL.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to analyze |
| `from` | No | Start date |
| `to` | No | End date |
| `granularity` | No | daily, weekly, monthly |
| `includeMetadataChanges` | No | Track metadata changes |

### 7. `wayback_analyze_changes`

SEO-focused analysis of changes between two dates.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to analyze |
| `beforeDate` | Yes | Start date (YYYY-MM-DD) |
| `afterDate` | Yes | End date (YYYY-MM-DD) |
| `analysisDepth` | No | quick, standard, deep |

**SEO Impact Scoring:**
- Title removal: -30 points
- Title addition: +20 points
- Meta description changes: +/-15 points
- H1 removal: -20 points
- Noindex added: -50 points
- Content reduction >30%: -20 points
- Score range: -100 to +100

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WAYBACK_CACHE_PATH` | `~/.wayback-mcp/cache.json` | Cache file location |
| `WAYBACK_CACHE_TTL` | `3600` | Default cache TTL in seconds |
| `WAYBACK_LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

## Code Patterns

### Error Handling

Custom `WaybackApiError` class with structured error codes:

```typescript
throw new WaybackApiError({
  code: ERROR_CODES.NOT_FOUND,
  message: 'URL not found in Wayback Machine',
  details: { status: 404 }
});
```

**Error Codes:**
| Code | Description |
|------|-------------|
| `NOT_FOUND` | URL not in archive |
| `RATE_LIMITED` | Too many requests |
| `INVALID_URL` | Malformed URL |
| `INVALID_TIMESTAMP` | Bad timestamp format |
| `FETCH_FAILED` | Network error |
| `PARSE_ERROR` | HTML parsing failed |
| `API_ERROR` | Wayback API error |
| `TIMEOUT` | Request timeout |

### Rate Limiting

Conservative limits respecting archive.org policies:

| Endpoint | Limit | Window |
|----------|-------|--------|
| Availability | 15 req | 1 minute |
| CDX | 10 req | 1 minute |
| Content | 5 req | 1 minute |

Rate limiter automatically waits when limits reached.

### Caching Strategy

TTL-based caching with automatic cleanup:

| Data Type | TTL | Reason |
|-----------|-----|--------|
| Availability | 1 hour | Can change frequently |
| Snapshot list | 24 hours | Historical list stable |
| Snapshot content | 7 days | Archived content immutable |
| CDX queries | 12 hours | Balance freshness/performance |
| Bulk check | 1 hour | Same as availability |

### Retry Logic

Exponential backoff with smart retry decisions:
- Max 3 retries by default
- Backoff: `2^attempt * 2000ms`
- 429/503: Wait and retry
- 404: Fail immediately (no retry)
- 5xx: Retry with backoff

## MCP Client Setup

### Claude Desktop Configuration

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wayback": {
      "command": "node",
      "args": ["/path/to/wayback-mcp-server/dist/index.js"],
      "env": {
        "WAYBACK_CACHE_PATH": "~/.wayback-mcp/cache.json",
        "WAYBACK_LOG_LEVEL": "info"
      }
    }
  }
}
```

### Using npm Global Install

```bash
npm install -g wayback-mcp-server
```

Then in config:
```json
{
  "mcpServers": {
    "wayback": {
      "command": "wayback-mcp"
    }
  }
}
```

## Troubleshooting

### Common Errors

**URL Not Found**
```
Code: NOT_FOUND
```
- The URL was never archived
- Try broader search with `matchType: 'domain'`
- Check archive.org directly to verify

**Rate Limited**
```
Code: RATE_LIMITED
```
- Automatic retry with backoff kicks in
- Wait for rate limit window to reset
- Check `getRemainingRequests()` for quota

**Cache Issues**
- Delete `~/.wayback-mcp/cache.json` to reset
- Cache auto-recreates on next run
- Expired entries cleaned on startup

**Network Timeout**
```
Code: TIMEOUT
```
- Check connectivity to archive.org
- Wayback Machine may be under heavy load
- Retry after a few minutes

### Debug Mode

Set `WAYBACK_LOG_LEVEL=debug` for verbose output:
```bash
WAYBACK_LOG_LEVEL=debug npm start
```

## Testing

### Current State

No automated tests are included. The codebase relies on:
- Zod schemas for runtime validation
- TypeScript strict mode for type safety

### Manual Testing

Test tools via MCP client or direct invocation:

```bash
# Build and run
npm run build && npm start

# In another terminal, send JSON-RPC requests via stdio
```

### Areas for Test Coverage

Priority areas for future tests:
1. Rate limiter sliding window logic
2. Cache expiration and cleanup
3. Retry logic with various HTTP codes
4. HTML metadata extraction
5. Diff generation accuracy
6. Date/timestamp normalization

## External APIs

The server uses these Internet Archive endpoints:

| API | Endpoint | Purpose |
|-----|----------|---------|
| Availability | `https://archive.org/wayback/available` | Check if URL archived |
| CDX Server | `https://web.archive.org/cdx/search/cdx` | List snapshots |
| Snapshot | `https://web.archive.org/web/{timestamp}/{url}` | Fetch content |
| Raw Snapshot | `https://web.archive.org/web/{timestamp}id_/{url}` | Fetch without banner |

## Dependencies

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP protocol implementation |
| `cheerio` | ^1.0.0-rc.12 | HTML parsing and DOM querying |
| `diff` | ^5.1.0 | Text diff generation |
| `zod` | ^3.22.4 | Runtime schema validation |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.3.3 | TypeScript compiler |
| `@types/node` | ^20.10.0 | Node.js type definitions |
| `@types/diff` | ^5.0.8 | Diff library types |

## Production Considerations

### Strengths

- Built-in retry logic with exponential backoff
- Conservative rate limiting respects archive.org
- Caching reduces redundant API calls
- Type safety via Zod throughout
- Graceful shutdown with SIGINT/SIGTERM handlers

### Limitations

- No structured logging (uses console)
- No health check endpoint
- No metrics collection
- Single-threaded processing
- Hardcoded timeouts

### Future Enhancements

Consider adding:
- Structured logging (Winston/Pino)
- Health check for monitoring
- Request ID correlation
- Configurable timeouts via env vars
- Async queue for bulk operations
