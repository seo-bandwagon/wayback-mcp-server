import type { WaybackClient } from './client.js';
import { CACHE_TTL } from '../cache/cache.js';
import { formatTimestamp } from '../utils/date.js';
import { parseHtml, truncateText } from '../utils/html-parser.js';
import { WaybackApiError, ERROR_CODES } from '../types/index.js';
import type {
  SnapshotContentQuery,
  SnapshotContentResponse,
  SnapshotMetadata,
  ParsedContent
} from '../types/index.js';

export class SnapshotsApi {
  private client: WaybackClient;

  constructor(client: WaybackClient) {
    this.client = client;
  }

  /**
   * Fetch the content of a specific snapshot
   */
  async getSnapshotContent(params: SnapshotContentQuery): Promise<SnapshotContentResponse> {
    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('content', {
      url: params.url,
      timestamp: params.timestamp,
      extractMetadata: params.extractMetadata
    });

    // Check cache (only if not requesting raw HTML)
    if (!params.includeRawHtml) {
      const cached = cache.get<SnapshotContentResponse>(cacheKey);
      if (cached) return cached;
    }

    // Build raw URL (without Wayback toolbar)
    const snapshotUrl = this.client.getRawSnapshotUrl(params.timestamp, params.url);

    // Fetch content - use fetchWithFinalUrl to get actual timestamp from redirect
    let html: string;
    let actualTimestamp = params.timestamp;
    let statusCode = 200;

    try {
      const result = await this.client.withRetry(async () => {
        return this.client.fetchTextWithFinalUrl(snapshotUrl);
      }, 'web/content');

      html = result.text;

      // Extract actual timestamp from final URL if redirected
      // Wayback URLs follow pattern: /web/{timestamp}id_/{url} or /web/{timestamp}/{url}
      const timestampMatch = result.finalUrl.match(/\/web\/(\d{14})(?:id_)?\//);
      if (timestampMatch) {
        actualTimestamp = timestampMatch[1];
      }
    } catch (error) {
      if (error instanceof WaybackApiError && error.code === ERROR_CODES.NOT_FOUND) {
        throw new WaybackApiError({
          code: ERROR_CODES.NOT_FOUND,
          message: `Snapshot not found for ${params.url} at ${params.timestamp}`
        });
      }
      throw error;
    }

    // Parse HTML if requested
    let metadata: SnapshotMetadata | undefined;
    let textContent: string | undefined;

    if (params.extractMetadata !== false) {
      const parsed = parseHtml(html, params.url);
      metadata = this.extractMetadata(parsed);
      textContent = truncateText(parsed.textContent, params.maxContentLength || 50000);
    }

    const response: SnapshotContentResponse = {
      url: params.url,
      timestamp: actualTimestamp, // Use actual timestamp from redirect
      formattedDate: formatTimestamp(actualTimestamp),
      waybackUrl: this.client.getSnapshotUrl(actualTimestamp, params.url),
      statusCode,
      contentLength: html.length,
      metadata,
      textContent
    };

    // Add note if timestamp differs from requested
    if (actualTimestamp !== params.timestamp) {
      response.requestedTimestamp = params.timestamp;
      response.note = `Closest snapshot found. Requested: ${params.timestamp}, Actual: ${actualTimestamp}`;
    }

    // Include raw HTML if requested
    if (params.includeRawHtml) {
      response.rawHtml = html;
    }

    // Cache (only if not including raw HTML to save space)
    if (!params.includeRawHtml) {
      cache.set(cacheKey, response, CACHE_TTL.SNAPSHOT_CONTENT);
    }

    return response;
  }

  /**
   * Get parsed content for a snapshot (full ParsedContent)
   */
  async getParsedContent(url: string, timestamp: string): Promise<ParsedContent> {
    const snapshotUrl = this.client.getRawSnapshotUrl(timestamp, url);

    const html = await this.client.withRetry(async () => {
      return this.client.fetchText(snapshotUrl);
    }, 'web/content');

    return parseHtml(html, url);
  }

  /**
   * Extract SEO-relevant metadata from parsed content
   */
  private extractMetadata(parsed: ParsedContent): SnapshotMetadata {
    const internalLinks = parsed.links.filter(l => !l.isExternal).length;
    const externalLinks = parsed.links.filter(l => l.isExternal).length;

    return {
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      metaKeywords: parsed.metaKeywords,
      canonicalUrl: parsed.canonicalUrl,
      ogTitle: parsed.ogTitle,
      ogDescription: parsed.ogDescription,
      h1: parsed.h1,
      h2: parsed.h2,
      robots: parsed.robots,
      wordCount: parsed.wordCount,
      linkCount: {
        internal: internalLinks,
        external: externalLinks
      }
    };
  }
}
