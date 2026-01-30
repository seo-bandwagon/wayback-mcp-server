import type { WaybackClient } from '../api/client.js';
import { AvailabilityApi } from '../api/availability.js';
import { CdxApi } from '../api/cdx.js';
import { SnapshotsApi } from '../api/snapshots.js';
import { DiffService } from '../api/diff.js';
import { handleToolError } from '../utils/errors.js';
import {
  AvailabilityQuerySchema,
  SnapshotsQuerySchema,
  SnapshotContentQuerySchema,
  CompareSnapshotsQuerySchema,
  BulkCheckQuerySchema,
  ChangesTimelineQuerySchema,
  AnalyzeChangesQuerySchema,
  SiteUrlsQuerySchema
} from '../types/index.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<string>;
}

export function createTools(client: WaybackClient): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const availabilityApi = new AvailabilityApi(client);
  const cdxApi = new CdxApi(client);
  const snapshotsApi = new SnapshotsApi(client);
  const diffService = new DiffService(client);

  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    // 1. Check Availability
    {
      name: 'wayback_check_availability',
      description: 'Check if a URL is archived in the Wayback Machine and get the closest available snapshot. Optionally specify a target timestamp to find the nearest archive to that date.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to check for availability'
          },
          timestamp: {
            type: 'string',
            description: 'Optional target timestamp (YYYYMMDDhhmmss or YYYY-MM-DD) to find closest snapshot'
          },
          checkWwwVariant: {
            type: 'boolean',
            description: 'If URL not found, also check www/non-www variant (default: true)'
          }
        },
        required: ['url']
      }
    },

    // 2. Get Snapshots
    {
      name: 'wayback_get_snapshots',
      description: 'Get a list of all archived snapshots for a URL with filtering by date range, status code, and deduplication options. Uses the CDX Server API for comprehensive results.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to get snapshots for'
          },
          matchType: {
            type: 'string',
            enum: ['exact', 'prefix', 'host', 'domain'],
            description: 'URL matching type: exact (default), prefix (URL starts with), host (same host), domain (entire domain)'
          },
          from: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD or YYYYMMDDhhmmss)'
          },
          to: {
            type: 'string',
            description: 'End date (YYYY-MM-DD or YYYYMMDDhhmmss)'
          },
          statusFilter: {
            type: 'string',
            enum: ['200', '2xx', '3xx', '4xx', '5xx', 'all'],
            description: 'Filter by HTTP status code (default: 200)'
          },
          collapse: {
            type: 'string',
            enum: ['none', 'daily', 'monthly', 'yearly', 'digest'],
            description: 'Deduplicate results: daily/monthly/yearly (by time), digest (by content hash)'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of snapshots to return (default: 100, max: 10000)'
          }
        },
        required: ['url']
      }
    },

    // 3. Get Snapshot Content
    {
      name: 'wayback_get_snapshot_content',
      description: 'Fetch the content of a specific Wayback Machine snapshot. Returns the HTML content along with extracted metadata like title, meta description, and headings.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The original URL'
          },
          timestamp: {
            type: 'string',
            description: 'The snapshot timestamp (YYYYMMDDhhmmss)'
          },
          extractMetadata: {
            type: 'boolean',
            description: 'Extract SEO metadata (title, description, headings) - default: true'
          },
          includeRawHtml: {
            type: 'boolean',
            description: 'Include the raw HTML in response (can be large) - default: false'
          },
          maxContentLength: {
            type: 'number',
            description: 'Maximum content length to return in characters (default: 50000)'
          }
        },
        required: ['url', 'timestamp']
      }
    },

    // 4. Compare Snapshots
    {
      name: 'wayback_compare_snapshots',
      description: 'Compare two Wayback Machine snapshots to identify changes between them. Highlights differences in title, meta description, headings, content, and structure.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to compare snapshots for'
          },
          timestamp1: {
            type: 'string',
            description: 'First (earlier) snapshot timestamp (YYYYMMDDhhmmss)'
          },
          timestamp2: {
            type: 'string',
            description: 'Second (later) snapshot timestamp (YYYYMMDDhhmmss)'
          },
          compareElements: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['title', 'description', 'headings', 'content', 'links', 'structure', 'all']
            },
            description: 'Elements to compare (default: all)'
          },
          showDiff: {
            type: 'boolean',
            description: 'Show detailed text diff for changed content (default: true)'
          }
        },
        required: ['url', 'timestamp1', 'timestamp2']
      }
    },

    // 5. Bulk Check
    {
      name: 'wayback_bulk_check',
      description: 'Check multiple URLs for Wayback Machine availability in a single operation. Useful for auditing site archive coverage.',
      inputSchema: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of URLs to check (max 50)'
          },
          timestamp: {
            type: 'string',
            description: 'Optional target timestamp to find closest snapshots'
          },
          includeSnapshotCount: {
            type: 'boolean',
            description: 'Include total snapshot count for each URL (slower) - default: false'
          },
          checkWwwVariant: {
            type: 'boolean',
            description: 'If URL not found, also check www/non-www variant (default: true)'
          }
        },
        required: ['urls']
      }
    },

    // 6. Changes Timeline
    {
      name: 'wayback_get_changes_timeline',
      description: 'Get a timeline of content changes for a URL. Identifies when significant changes occurred by comparing content digests across snapshots.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to analyze'
          },
          from: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD)'
          },
          to: {
            type: 'string',
            description: 'End date (YYYY-MM-DD)'
          },
          granularity: {
            type: 'string',
            enum: ['daily', 'weekly', 'monthly'],
            description: 'Time granularity for change detection (default: monthly)'
          },
          includeMetadataChanges: {
            type: 'boolean',
            description: 'Detect changes in title/description (requires fetching content) - default: false'
          }
        },
        required: ['url']
      }
    },

    // 7. Analyze Changes
    {
      name: 'wayback_analyze_changes',
      description: 'Analyze what changed on a page between two dates. Automatically finds the closest snapshots and provides detailed SEO-focused analysis of the changes.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to analyze'
          },
          beforeDate: {
            type: 'string',
            description: 'Date before the suspected change (YYYY-MM-DD)'
          },
          afterDate: {
            type: 'string',
            description: 'Date after the suspected change (YYYY-MM-DD)'
          },
          analysisDepth: {
            type: 'string',
            enum: ['quick', 'standard', 'deep'],
            description: 'Analysis depth - quick (metadata only), standard (content summary), deep (full diff)'
          }
        },
        required: ['url', 'beforeDate', 'afterDate']
      }
    },

    // 8. Get Site URLs
    {
      name: 'wayback_get_site_urls',
      description: 'Get all unique URLs archived for a domain or URL prefix. Useful for discovering site structure, finding removed pages, and conducting site-wide SEO audits.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Domain or URL prefix (e.g., "example.com" or "example.com/blog/")'
          },
          matchType: {
            type: 'string',
            enum: ['exact', 'prefix', 'host', 'domain'],
            description: 'Scope of search: "domain" (default, includes all subdomains), "host" (single host), "prefix" (URL path prefix), "exact" (single URL)'
          },
          from: {
            type: 'string',
            description: 'Start date filter (YYYY-MM-DD or YYYYMMDDhhmmss)'
          },
          to: {
            type: 'string',
            description: 'End date filter (YYYY-MM-DD or YYYYMMDDhhmmss)'
          },
          statusFilter: {
            type: 'string',
            enum: ['200', '2xx', '3xx', '4xx', '5xx', 'all'],
            description: 'Filter by HTTP status code (default: 200)'
          },
          limit: {
            type: 'number',
            description: 'Maximum URLs to return (1-10000, default: 1000)'
          },
          includeSubdomains: {
            type: 'boolean',
            description: 'Include subdomains when matchType is "domain" (default: true)'
          },
          includeCaptureCounts: {
            type: 'boolean',
            description: 'Include capture count per URL - slower but shows first/last capture dates (default: false)'
          },
          mimeTypeFilter: {
            type: 'string',
            description: 'Filter by MIME type (e.g., "text/html" to exclude images/css/js)'
          }
        },
        required: ['url']
      }
    }
  ];

  // Register handlers

  // 1. Check Availability
  handlers.set('wayback_check_availability', async (args) => {
    try {
      const params = AvailabilityQuerySchema.parse(args);
      const result = await availabilityApi.checkAvailability(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 2. Get Snapshots
  handlers.set('wayback_get_snapshots', async (args) => {
    try {
      const params = SnapshotsQuerySchema.parse(args);
      const result = await cdxApi.getSnapshots(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 3. Get Snapshot Content
  handlers.set('wayback_get_snapshot_content', async (args) => {
    try {
      const params = SnapshotContentQuerySchema.parse(args);
      const result = await snapshotsApi.getSnapshotContent(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 4. Compare Snapshots
  handlers.set('wayback_compare_snapshots', async (args) => {
    try {
      const params = CompareSnapshotsQuerySchema.parse(args);
      const result = await diffService.compareSnapshots(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 5. Bulk Check
  handlers.set('wayback_bulk_check', async (args) => {
    try {
      const params = BulkCheckQuerySchema.parse(args);
      const results = await availabilityApi.checkBulkAvailability(
        params.urls,
        params.timestamp,
        params.checkWwwVariant
      );

      // Build response
      const resultArray = Array.from(results.entries()).map(([url, result]) => ({
        url,
        isArchived: result.isArchived,
        closestSnapshot: result.closestSnapshot ? {
          timestamp: result.closestSnapshot.timestamp,
          formattedDate: result.closestSnapshot.formattedDate,
          waybackUrl: result.closestSnapshot.url
        } : undefined,
        checkedVariant: result.checkedVariant
      }));

      // Get snapshot counts if requested
      let snapshotCountErrors = 0;
      if (params.includeSnapshotCount) {
        for (const item of resultArray) {
          try {
            const count = await cdxApi.getSnapshotCount(item.url);
            (item as Record<string, unknown>).snapshotCount = count;
          } catch {
            (item as Record<string, unknown>).snapshotCount = -1; // -1 indicates error
            snapshotCountErrors++;
          }
        }
      }

      const archivedCount = resultArray.filter(r => r.isArchived).length;
      const timestamps = resultArray
        .filter(r => r.closestSnapshot)
        .map(r => r.closestSnapshot!.timestamp)
        .sort();

      const response: Record<string, unknown> = {
        totalUrls: params.urls.length,
        archivedCount,
        notArchivedCount: params.urls.length - archivedCount,
        results: resultArray,
        summary: {
          archiveRate: Math.round((archivedCount / params.urls.length) * 100),
          oldestSnapshot: timestamps[0] || 'N/A',
          newestSnapshot: timestamps[timestamps.length - 1] || 'N/A'
        }
      };

      // Add error info if any snapshot counts failed
      if (snapshotCountErrors > 0) {
        response.snapshotCountErrors = snapshotCountErrors;
        response.snapshotCountNote = `${snapshotCountErrors} URL(s) could not retrieve snapshot counts due to rate limiting or errors. Values of -1 indicate unknown counts.`;
      }

      return JSON.stringify(response, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 6. Changes Timeline
  handlers.set('wayback_get_changes_timeline', async (args) => {
    try {
      const params = ChangesTimelineQuerySchema.parse(args);
      const result = await cdxApi.getChangesTimeline(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 7. Analyze Changes
  handlers.set('wayback_analyze_changes', async (args) => {
    try {
      const params = AnalyzeChangesQuerySchema.parse(args);
      const result = await diffService.analyzeChanges(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  // 8. Get Site URLs
  handlers.set('wayback_get_site_urls', async (args) => {
    try {
      const params = SiteUrlsQuerySchema.parse(args);
      const result = await cdxApi.getSiteUrls(params);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
