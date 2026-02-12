import type { WaybackClient } from './client.js';
import { CdxApi } from './cdx.js';
import { SnapshotsApi } from './snapshots.js';
import { WaybackApiError, ERROR_CODES, SnapshotsQuerySchema, SiteUrlsQuerySchema, SnapshotContentQuerySchema } from '../types/index.js';

export interface ExtractLinksParams {
  url: string;
  timestamp?: string;
  includeInternal?: boolean;
}

export interface ExtractLinksResult {
  url: string;
  timestamp: string;
  totalLinks: number;
  externalDomains: string[];
  internalLinks?: string[];
}

export interface ResearchParams {
  domain: string;
  pathPrefix?: string;
  limit?: number;
  processLimit?: number;
  fromYear?: number;  // Start from a specific year (default: 1996)
}

export interface ProcessedUrl {
  url: string;
  timestamp: string;
  date: string;
  title: string | null;
  description: string | null;
}

export interface Finding {
  type: 'announcement' | 'jobs' | 'partnership' | 'acquisition' | 'product';
  url: string;
  timestamp: string;
  title: string | null;
}

export interface ResearchResult {
  domain: string;
  totalArchived: number;
  processed: number;
  urls: ProcessedUrl[];
  externalDomains: string[];
  findings: Finding[];
  pathPrefix?: string;
  notes: string[];
}

// Helper to parse URL - handles both browser and Node environments
function parseUrl(urlStr: string, base?: string): { hostname: string; href: string } | null {
  try {
    const url = base ? new (globalThis.URL || URL)(urlStr, base) : new (globalThis.URL || URL)(urlStr);
    return { hostname: url.hostname, href: url.href };
  } catch {
    return null;
  }
}

// Helper for delay - respects rate limits per IA guidelines
function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    if (typeof globalThis.setTimeout !== 'undefined') {
      globalThis.setTimeout(resolve, ms);
    } else {
      resolve();
    }
  });
}

// Minimum delay between content fetches (per IA rate limit guidelines)
const CONTENT_FETCH_DELAY_MS = 500;
// Minimum delay between CDX queries
const CDX_QUERY_DELAY_MS = 200;

export class ResearchApi {
  private client: WaybackClient;
  private cdxApi: CdxApi;
  private snapshotsApi: SnapshotsApi;

  constructor(client: WaybackClient) {
    this.client = client;
    this.cdxApi = new CdxApi(client);
    this.snapshotsApi = new SnapshotsApi(client);
  }

  /**
   * Extract links from an archived page
   */
  async extractLinks(params: ExtractLinksParams): Promise<ExtractLinksResult> {
    let timestamp = params.timestamp;
    
    if (!timestamp) {
      const snapshotParams = SnapshotsQuerySchema.parse({
        url: params.url,
        matchType: 'exact',
        statusFilter: '200',
        limit: 1
      });
      
      const snapshots = await this.cdxApi.getSnapshots(snapshotParams);
      
      if (snapshots.snapshots.length === 0) {
        throw new WaybackApiError({
          code: ERROR_CODES.NOT_FOUND,
          message: `No archived snapshots found for ${params.url}`
        });
      }
      
      timestamp = snapshots.snapshots[0].timestamp;
    }

    const contentParams = SnapshotContentQuerySchema.parse({
      url: params.url,
      timestamp,
      extractMetadata: false,
      includeRawHtml: true
    });
    
    const content = await this.snapshotsApi.getSnapshotContent(contentParams);
    const html = content.rawHtml || '';
    
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    const links = new Set<string>();
    const externalDomains = new Set<string>();
    const internalLinks: string[] = [];

    const sourceUrl = parseUrl(params.url);
    const sourceDomain = sourceUrl ? sourceUrl.hostname.replace(/^www\./, '') : params.url;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];

      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
        continue;
      }

      const absoluteUrl = parseUrl(href, params.url);
      if (absoluteUrl) {
        const linkDomain = absoluteUrl.hostname.replace(/^www\./, '');

        links.add(absoluteUrl.href);

        if (linkDomain !== sourceDomain && !linkDomain.includes('archive.org')) {
          externalDomains.add(linkDomain);
        } else if (params.includeInternal) {
          internalLinks.push(absoluteUrl.href);
        }
      }
    }

    return {
      url: params.url,
      timestamp,
      totalLinks: links.size,
      externalDomains: Array.from(externalDomains).sort(),
      internalLinks: params.includeInternal ? internalLinks : undefined
    };
  }

  /**
   * Research a domain systematically
   * 
   * Note: This fetches URLs and sorts by timestamp client-side.
   * For very large domains, this may not capture all oldest URLs due to CDX API limits.
   * The CDX API returns results in SURT (URL) order, not timestamp order.
   * Use fromYear parameter to focus on a specific time period if needed.
   */
  async researchDomain(params: ResearchParams): Promise<ResearchResult> {
    const domain = params.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const limit = Math.min(params.limit || 100, 1000); // Cap at 1000 for reasonable response time
    const processLimit = Math.min(params.processLimit || 20, 50); // Cap processing
    const fromYear = params.fromYear || 1996; // Wayback Machine started 1996
    
    const notes: string[] = [];

    // Build URL pattern
    const urlPattern = params.pathPrefix 
      ? `${domain}${params.pathPrefix}`
      : domain;

    // Step 1: Get URLs with date filter to focus on older content
    // We use from= to start from an old date, which helps find early captures
    const siteUrlParams = SiteUrlsQuerySchema.parse({
      url: urlPattern,
      matchType: params.pathPrefix ? 'prefix' : 'domain',
      mimeTypeFilter: 'text/html',
      statusFilter: '200',
      from: `${fromYear}0101`,
      limit: limit * 2, // Fetch more to allow for sorting
      includeCaptureCounts: true // Get first/last capture dates for sorting
    });

    await delay(CDX_QUERY_DELAY_MS);
    const siteUrls = await this.cdxApi.getSiteUrls(siteUrlParams);

    if (siteUrls.urls.length === 0) {
      return {
        domain,
        totalArchived: 0,
        processed: 0,
        urls: [],
        externalDomains: [],
        findings: [],
        pathPrefix: params.pathPrefix,
        notes: ['No archived URLs found for this domain/path']
      };
    }

    // Sort by firstCapture timestamp (oldest first)
    const sortedUrls = [...siteUrls.urls].sort((a, b) => 
      a.firstCapture.localeCompare(b.firstCapture)
    );

    // Take only the requested limit after sorting
    const urlsToProcess = sortedUrls.slice(0, limit);

    if (siteUrls.truncated) {
      notes.push(`Results were truncated. Total URLs may exceed ${siteUrls.urls.length}. Use pathPrefix to narrow scope.`);
    }

    notes.push(`Found ${siteUrls.urls.length} URLs, sorted by oldest first, processing ${Math.min(urlsToProcess.length, processLimit)}`);

    // Step 2: Process URLs and extract info
    const processedUrls: ProcessedUrl[] = [];
    const allExternalDomains = new Set<string>();
    const findings: Finding[] = [];

    const toProcess = Math.min(urlsToProcess.length, processLimit);

    for (let i = 0; i < toProcess; i++) {
      const item = urlsToProcess[i];
      const url = item.url;
      const timestamp = item.firstCapture;

      try {
        // Rate limit: delay between content fetches per IA guidelines
        await delay(CONTENT_FETCH_DELAY_MS);
        
        const contentParams = SnapshotContentQuerySchema.parse({
          url,
          timestamp,
          extractMetadata: true,
          includeRawHtml: true
        });
        
        const content = await this.snapshotsApi.getSnapshotContent(contentParams);
        const html = content.rawHtml || '';

        // Extract external links
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          const absoluteUrl = parseUrl(match[1], url);
          if (absoluteUrl) {
            const sourceUrl = parseUrl(url);
            const sourceDomain = sourceUrl ? sourceUrl.hostname.replace(/^www\./, '') : '';
            const linkDomain = absoluteUrl.hostname.replace(/^www\./, '');
            if (linkDomain && linkDomain !== sourceDomain && !linkDomain.includes('archive.org')) {
              allExternalDomains.add(linkDomain);
            }
          }
        }

        processedUrls.push({
          url,
          timestamp,
          date: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`,
          title: content.metadata?.title || null,
          description: content.metadata?.metaDescription || null
        });

        // Look for interesting findings
        const lowerHtml = html.toLowerCase();
        const title = content.metadata?.title || null;

        if (lowerHtml.includes('press release') || lowerHtml.includes('news release')) {
          findings.push({ type: 'announcement', url, timestamp, title });
        }
        if (lowerHtml.includes('careers') || lowerHtml.includes('job opening') || lowerHtml.includes("we're hiring") || lowerHtml.includes('employment')) {
          findings.push({ type: 'jobs', url, timestamp, title });
        }
        if (lowerHtml.includes('partnership') || lowerHtml.includes('strategic alliance')) {
          findings.push({ type: 'partnership', url, timestamp, title });
        }
        if (lowerHtml.includes('acquisition') || lowerHtml.includes('acquired') || lowerHtml.includes('merger')) {
          findings.push({ type: 'acquisition', url, timestamp, title });
        }
        if (lowerHtml.includes('announces') || lowerHtml.includes('introducing') || lowerHtml.includes('now available')) {
          findings.push({ type: 'product', url, timestamp, title });
        }

      } catch {
        // Skip failed URLs - may be unavailable or rate limited
      }
    }

    return {
      domain,
      totalArchived: siteUrls.urls.length,
      processed: processedUrls.length,
      urls: processedUrls,
      externalDomains: Array.from(allExternalDomains).sort(),
      findings,
      pathPrefix: params.pathPrefix,
      notes
    };
  }
}
