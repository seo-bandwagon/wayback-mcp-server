# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-30

### Added

- Initial release
- 7 MCP tools for Wayback Machine interaction:
  - `wayback_check_availability` - Check archive availability
  - `wayback_get_snapshots` - List snapshots with filtering
  - `wayback_get_snapshot_content` - Fetch content with metadata
  - `wayback_compare_snapshots` - Compare two snapshots
  - `wayback_bulk_check` - Batch availability checking
  - `wayback_get_changes_timeline` - Content change timeline
  - `wayback_analyze_changes` - SEO impact analysis
- Rate limiting (15/10/5 requests per minute by endpoint)
- JSON file-based caching with TTL
- Retry logic with exponential backoff
- SEO metadata extraction using Cheerio
- TypeScript with strict mode and Zod validation
