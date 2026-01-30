# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-01-30

### Fixed

- `wayback_check_availability` now uses CDX API fallback for older archives
  - Fixes false negatives for sites like Geocities that exist in CDX but not Availability API
- `wayback_compare_snapshots` now correctly returns `hasChanges: false` for identical timestamps
  - Previously returned `hasChanges: true` even when comparing the same snapshot
- `wayback_get_snapshot_content` now returns the actual snapshot timestamp
  - Previously echoed back the requested timestamp even when redirected to closest match
  - Added `requestedTimestamp` and `note` fields when timestamp differs

## [1.1.0] - 2026-01-30

### Added

- New `wayback_get_site_urls` tool for site-wide URL discovery
  - Get all unique URLs archived for a domain or URL prefix
  - Supports domain, host, prefix, and exact match types
  - Date range and status code filtering
  - MIME type filtering (e.g., HTML only)
  - Subdomain extraction and path structure analysis
  - Optional capture count aggregation
- Automatic www/non-www variant checking for availability tools
  - New `checkWwwVariant` parameter (default: true)
  - `checkedVariant` field in responses shows which URL was found

### Fixed

- `wayback_bulk_check` no longer crashes with `includeSnapshotCount=true`
  - Improved error handling with `-1` for failed lookups
  - Added `snapshotCountErrors` and `snapshotCountNote` fields

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
