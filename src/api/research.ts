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
}

// Helper to parse URL - handles both browser and Node environments
function parseUrl(urlStr: string, base?: string): { hostname: string; href: string } | null {
  try {
    // Try using global URL (works in both environments)
    const url = base ? new (globalThis.URL || URL)(urlStr, base) : new (globalThis.URL || URL)(urlStr);
    return { hostname: url.hostname, href: url.href };
  } catch {
    return null;
  }
}

// Helper for delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    if (typeof globalThis.setTimeout !== 'undefined') {
      globalThis.setTimeout(resolve, ms);
    } else {
      // Fallback - just resolve immediately
      resolve();
    }
  });
}

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
    // Get the snapshot content
    let timestamp = params.timestamp;
    
    if (!timestamp) {
      // Get latest snapshot using the schema to apply defaults
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

    // Fetch the content using schema to apply defaults
    const contentParams = SnapshotContentQuerySchema.parse({
      url: params.url,
      timestamp,
      extractMetadata: false,
      includeRawHtml: true
    });
    
    const content = await this.snapshotsApi.getSnapshotContent(contentParams);

    const html = content.rawHtml || '';
    
    // Extract links
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    const links = new Set<string>();
    const externalDomains = new Set<string>();
    const internalLinks: string[] = [];

    const sourceUrl = parseUrl(params.url);
    const sourceDomain = sourceUrl ? sourceUrl.hostname.replace(/^www\./, '') : params.url;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];

      // Skip anchors, javascript, mailto
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
        continue;
      }

      // Handle relative URLs
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
   */
  async researchDomain(params: ResearchParams): Promise<ResearchResult> {
    const domain = params.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const limit = params.limit || 100;
    const processLimit = params.processLimit || 20;

    // Step 1: Get all text URLs, sorted oldest first
    const urlPattern = params.pathPrefix 
      ? `${domain}${params.pathPrefix}`
      : domain;

    // Use schema to apply defaults
    const siteUrlParams = SiteUrlsQuerySchema.parse({
      url: urlPattern,
      matchType: params.pathPrefix ? 'prefix' : 'domain',
      mimeTypeFilter: 'text/html',
      statusFilter: '200',
      sortBy: 'oldest',
      limit,
      includeCaptureCounts: false
    });

    const siteUrls = await this.cdxApi.getSiteUrls(siteUrlParams);

    if (siteUrls.urls.length === 0) {
      return {
        domain,
        totalArchived: 0,
        processed: 0,
        urls: [],
        externalDomains: [],
        findings: [],
        pathPrefix: params.pathPrefix
      };
    }

    // Step 2: Process URLs and extract info
    const processedUrls: ProcessedUrl[] = [];
    const allExternalDomains = new Set<string>();
    const findings: Finding[] = [];

    const toProcess = Math.min(siteUrls.urls.length, processLimit);

    for (let i = 0; i < toProcess; i++) {
      const item = siteUrls.urls[i];
      const url = item.url;
      const timestamp = item.firstCapture;

      try {
        // Get content using schema to apply defaults
        const contentParams = SnapshotContentQuerySchema.parse({
          url,
          timestamp,
          extractMetadata: true,
          includeRawHtml: true
        });
        
        const content = await this.snapshotsApi.getSnapshotContent(contentParams);

        const html = content.rawHtml || '';

        // Extract links
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          const absoluteUrl = parseUrl(match[1], url);
          if (absoluteUrl) {
            const sourceUrl = parseUrl(url);
            const sourceDomain = sourceUrl ? sourceUrl.hostname.replace(/^www\./, '') : '';
            const linkDomain = absoluteUrl.hostname.replace(/^www\./, '');
            if (linkDomain !== sourceDomain && !linkDomain.includes('archive.org')) {
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

        if (lowerHtml.includes('announcement') || lowerHtml.includes('press release')) {
          findings.push({ type: 'announcement', url, timestamp, title });
        }
        if (lowerHtml.includes('careers') || lowerHtml.includes('job opening') || lowerHtml.includes("we're hiring")) {
          findings.push({ type: 'jobs', url, timestamp, title });
        }
        if (lowerHtml.includes('partnership') || lowerHtml.includes('agreement')) {
          findings.push({ type: 'partnership', url, timestamp, title });
        }
        if (lowerHtml.includes('acquisition') || lowerHtml.includes('acquired')) {
          findings.push({ type: 'acquisition', url, timestamp, title });
        }
        if (lowerHtml.includes('new product') || lowerHtml.includes('launch') || lowerHtml.includes('introducing')) {
          findings.push({ type: 'product', url, timestamp, title });
        }

      } catch {
        // Skip failed URLs
      }

      // Rate limiting - small delay between requests
      await delay(100);
    }

    return {
      domain,
      totalArchived: siteUrls.urls.length,
      processed: processedUrls.length,
      urls: processedUrls,
      externalDomains: Array.from(allExternalDomains).sort(),
      findings,
      pathPrefix: params.pathPrefix
    };
  }
}
