import type { WaybackClient } from './client.js';
import { CACHE_TTL } from '../cache/cache.js';
import { normalizeTimestamp, formatTimestamp } from '../utils/date.js';
import { WaybackApiError, ERROR_CODES } from '../types/index.js';
import type {
  SnapshotsQuery,
  SnapshotsResponse,
  Snapshot,
  ChangesTimelineQuery,
  ChangesTimelineResponse,
  ChangeEvent,
  ChangeFrequency,
  SiteUrlsQuery,
  SiteUrlsResponse,
  SiteUrl
} from '../types/index.js';

export class CdxApi {
  private client: WaybackClient;

  constructor(client: WaybackClient) {
    this.client = client;
  }

  /**
   * Get all snapshots for a URL with filtering options
   */
  async getSnapshots(params: SnapshotsQuery): Promise<SnapshotsResponse> {
    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('cdx', params);

    const cached = cache.get<SnapshotsResponse>(cacheKey);
    if (cached) return cached;

    // Build CDX API URL
    const url = new URL(this.client.CDX_API);
    url.searchParams.set('url', params.url);
    url.searchParams.set('output', 'json');
    url.searchParams.set('fl', 'timestamp,original,mimetype,statuscode,digest,length');

    if (params.matchType && params.matchType !== 'exact') {
      url.searchParams.set('matchType', params.matchType);
    }

    if (params.from) {
      url.searchParams.set('from', normalizeTimestamp(params.from));
    }

    if (params.to) {
      url.searchParams.set('to', normalizeTimestamp(params.to));
    }

    if (params.statusFilter && params.statusFilter !== 'all') {
      const filterValue = params.statusFilter === '200'
        ? 'statuscode:200'
        : `statuscode:${params.statusFilter.replace('xx', '..')}`;
      url.searchParams.set('filter', filterValue);
    }

    if (params.collapse && params.collapse !== 'none') {
      const collapseMap: Record<string, string> = {
        'daily': 'timestamp:8',
        'monthly': 'timestamp:6',
        'yearly': 'timestamp:4',
        'digest': 'digest'
      };
      url.searchParams.set('collapse', collapseMap[params.collapse]);
    }

    if (params.limit) {
      url.searchParams.set('limit', String(Math.min(params.limit, 10000)));
    }

    // Fetch
    const result = await this.client.withRetry(async () => {
      const response = await this.client.fetch(url.toString());
      const text = await response.text();

      // Handle empty response
      if (!text.trim()) {
        return [];
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new WaybackApiError({
          code: ERROR_CODES.PARSE_ERROR,
          message: 'Failed to parse CDX response'
        });
      }
    }, 'cdx');

    // Parse CDX response (first row is header if output=json)
    const rows = Array.isArray(result) && result.length > 0
      ? result.slice(1) as string[][]
      : [];

    const snapshots: Snapshot[] = rows.map(row => ({
      timestamp: row[0],
      formattedDate: formatTimestamp(row[0]),
      originalUrl: row[1],
      mimeType: row[2] || 'text/html',
      statusCode: parseInt(row[3], 10) || 200,
      digest: row[4] || '',
      length: parseInt(row[5], 10) || 0,
      waybackUrl: this.client.getSnapshotUrl(row[0], row[1]),
      rawUrl: this.client.getRawSnapshotUrl(row[0], row[1])
    }));

    const response: SnapshotsResponse = {
      url: params.url,
      totalSnapshots: snapshots.length,
      dateRange: {
        first: snapshots.length > 0 ? snapshots[0].formattedDate : '',
        last: snapshots.length > 0 ? snapshots[snapshots.length - 1].formattedDate : ''
      },
      snapshots
    };

    cache.set(cacheKey, response, CACHE_TTL.SNAPSHOTS);

    return response;
  }

  /**
   * Get the snapshot count for a URL (quick query)
   */
  async getSnapshotCount(url: string): Promise<number> {
    const apiUrl = new URL(this.client.CDX_API);
    apiUrl.searchParams.set('url', url);
    apiUrl.searchParams.set('output', 'json');
    apiUrl.searchParams.set('fl', 'timestamp');
    apiUrl.searchParams.set('filter', 'statuscode:200');

    const result = await this.client.withRetry(async () => {
      const response = await this.client.fetch(apiUrl.toString());
      const text = await response.text();

      if (!text.trim()) return [];

      try {
        return JSON.parse(text);
      } catch {
        return [];
      }
    }, 'cdx');

    // Subtract 1 for header row
    return Array.isArray(result) ? Math.max(0, result.length - 1) : 0;
  }

  /**
   * Find the closest snapshot to a given timestamp
   */
  async findClosestSnapshot(url: string, targetTimestamp: string): Promise<Snapshot | null> {
    const normalized = normalizeTimestamp(targetTimestamp);

    // Query snapshots around the target date
    const result = await this.getSnapshots({
      url,
      from: normalized.slice(0, 8), // Get from that day
      matchType: 'exact',
      statusFilter: '200',
      collapse: 'none',
      limit: 10
    });

    if (result.snapshots.length === 0) {
      // Try a broader search
      const year = normalized.slice(0, 4);
      const broaderResult = await this.getSnapshots({
        url,
        from: year,
        to: String(parseInt(year, 10) + 1),
        matchType: 'exact',
        statusFilter: '200',
        collapse: 'monthly',
        limit: 50
      });

      if (broaderResult.snapshots.length === 0) {
        return null;
      }

      // Find closest by timestamp
      return this.findClosestByTimestamp(broaderResult.snapshots, normalized);
    }

    return this.findClosestByTimestamp(result.snapshots, normalized);
  }

  private findClosestByTimestamp(snapshots: Snapshot[], targetTimestamp: string): Snapshot {
    const targetNum = parseInt(targetTimestamp.padEnd(14, '0'), 10);

    let closest = snapshots[0];
    let closestDiff = Math.abs(parseInt(closest.timestamp, 10) - targetNum);

    for (const snapshot of snapshots) {
      const diff = Math.abs(parseInt(snapshot.timestamp, 10) - targetNum);
      if (diff < closestDiff) {
        closest = snapshot;
        closestDiff = diff;
      }
    }

    return closest;
  }

  /**
   * Get a timeline of content changes based on digest changes
   */
  async getChangesTimeline(params: ChangesTimelineQuery): Promise<ChangesTimelineResponse> {
    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('timeline', params);

    const cached = cache.get<ChangesTimelineResponse>(cacheKey);
    if (cached) return cached;

    // Get snapshots collapsed by digest (only unique content)
    const collapseMap: Record<string, string> = {
      'daily': 'daily',
      'weekly': 'daily', // Weekly uses daily then filters
      'monthly': 'monthly'
    };

    const snapshots = await this.getSnapshots({
      url: params.url,
      from: params.from,
      to: params.to,
      matchType: 'exact',
      statusFilter: '200',
      collapse: collapseMap[params.granularity || 'monthly'] as 'daily' | 'monthly',
      limit: 1000
    });

    // Detect changes by comparing consecutive digest values
    const changeEvents: ChangeEvent[] = [];
    let previousSnapshot: Snapshot | null = null;

    for (const snapshot of snapshots.snapshots) {
      if (previousSnapshot && previousSnapshot.digest !== snapshot.digest) {
        const daysDiff = this.calculateDaysBetween(previousSnapshot.timestamp, snapshot.timestamp);

        changeEvents.push({
          timestamp: snapshot.timestamp,
          formattedDate: snapshot.formattedDate,
          previousTimestamp: previousSnapshot.timestamp,
          daysSincePrevious: daysDiff,
          changeType: 'content',
          digestBefore: previousSnapshot.digest,
          digestAfter: snapshot.digest,
          waybackUrl: snapshot.waybackUrl
        });
      }
      previousSnapshot = snapshot;
    }

    // Filter by granularity for weekly
    const filteredEvents = params.granularity === 'weekly'
      ? changeEvents.filter((_, i) => i % 7 === 0 || i === changeEvents.length - 1)
      : changeEvents;

    // Calculate summary statistics
    const avgDays = filteredEvents.length > 0
      ? filteredEvents.reduce((sum, e) => sum + e.daysSincePrevious, 0) / filteredEvents.length
      : 0;

    const response: ChangesTimelineResponse = {
      url: params.url,
      dateRange: {
        from: snapshots.dateRange.first,
        to: snapshots.dateRange.last
      },
      totalSnapshots: snapshots.totalSnapshots,
      totalChanges: filteredEvents.length,
      changeEvents: filteredEvents,
      summary: {
        averageTimeBetweenChanges: this.formatDaysToHuman(avgDays),
        mostActiveMonth: this.findMostActiveMonth(filteredEvents),
        changeFrequency: this.calculateFrequency(avgDays)
      }
    };

    cache.set(cacheKey, response, CACHE_TTL.CDX_QUERIES);

    return response;
  }

  private calculateDaysBetween(ts1: string, ts2: string): number {
    const d1 = this.parseTimestamp(ts1);
    const d2 = this.parseTimestamp(ts2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  private parseTimestamp(ts: string): Date {
    const year = parseInt(ts.slice(0, 4), 10);
    const month = parseInt(ts.slice(4, 6), 10) - 1;
    const day = parseInt(ts.slice(6, 8), 10);
    return new Date(year, month, day);
  }

  private formatDaysToHuman(days: number): string {
    if (days < 1) return 'less than a day';
    if (days < 7) return `${Math.round(days)} days`;
    if (days < 30) return `${Math.round(days / 7)} weeks`;
    if (days < 365) return `${Math.round(days / 30)} months`;
    return `${Math.round(days / 365)} years`;
  }

  private findMostActiveMonth(events: ChangeEvent[]): string {
    if (events.length === 0) return 'N/A';

    const monthCounts: Record<string, number> = {};
    for (const event of events) {
      const month = event.timestamp.slice(0, 6);
      monthCounts[month] = (monthCounts[month] || 0) + 1;
    }

    let maxMonth = '';
    let maxCount = 0;
    for (const [month, count] of Object.entries(monthCounts)) {
      if (count > maxCount) {
        maxMonth = month;
        maxCount = count;
      }
    }

    // Format YYYYMM to YYYY-MM
    return `${maxMonth.slice(0, 4)}-${maxMonth.slice(4, 6)}`;
  }

  private calculateFrequency(avgDays: number): ChangeFrequency {
    if (avgDays < 7) return 'very_frequent';
    if (avgDays < 30) return 'frequent';
    if (avgDays < 90) return 'moderate';
    if (avgDays < 180) return 'infrequent';
    return 'rare';
  }

  /**
   * Get all unique URLs archived for a domain or URL prefix
   */
  async getSiteUrls(params: SiteUrlsQuery): Promise<SiteUrlsResponse> {
    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('site-urls', params);

    const cached = cache.get<SiteUrlsResponse>(cacheKey);
    if (cached) return cached;

    // Normalize URL - strip protocol
    const normalizedUrl = this.normalizeUrlForCdx(params.url);

    // Build CDX API URL
    const url = new URL(this.client.CDX_API);
    url.searchParams.set('url', normalizedUrl);
    url.searchParams.set('output', 'json');
    url.searchParams.set('fl', 'original,timestamp,statuscode,mimetype,digest');

    // Set matchType
    if (params.matchType) {
      url.searchParams.set('matchType', params.matchType);
    }

    // Date range filters
    if (params.from) {
      url.searchParams.set('from', normalizeTimestamp(params.from));
    }
    if (params.to) {
      url.searchParams.set('to', normalizeTimestamp(params.to));
    }

    // Build filters array
    const filters: string[] = [];

    // Status filter
    if (params.statusFilter && params.statusFilter !== 'all') {
      const statusFilterValue = params.statusFilter === '200'
        ? 'statuscode:200'
        : `statuscode:${params.statusFilter.replace('xx', '..')}`;
      filters.push(statusFilterValue);
    }

    // MIME type filter
    if (params.mimeTypeFilter) {
      filters.push(`mimetype:${params.mimeTypeFilter}`);
    }

    // Apply filters
    for (const filter of filters) {
      url.searchParams.append('filter', filter);
    }

    // Collapse strategy: use urlkey for unique URLs when not counting captures
    if (!params.includeCaptureCounts) {
      url.searchParams.set('collapse', 'urlkey');
    }

    // Request resumeKey to detect truncation
    url.searchParams.set('showResumeKey', 'true');

    // Limit - request more if we need to aggregate
    const requestLimit = params.includeCaptureCounts
      ? Math.min((params.limit || 1000) * 10, 100000) // Request more for aggregation
      : Math.min(params.limit || 1000, 10000);
    url.searchParams.set('limit', String(requestLimit));

    // Fetch
    const result = await this.client.withRetry(async () => {
      const response = await this.client.fetch(url.toString());
      const text = await response.text();

      if (!text.trim()) {
        return [];
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new WaybackApiError({
          code: ERROR_CODES.PARSE_ERROR,
          message: 'Failed to parse CDX response'
        });
      }
    }, 'cdx');

    // Check for resumeKey in response (indicates truncation)
    let resumeKey: string | undefined;
    let rows: string[][] = [];

    if (Array.isArray(result) && result.length > 0) {
      // Check if last element is resumeKey array
      const lastRow = result[result.length - 1];
      if (Array.isArray(lastRow) && lastRow.length === 2 && lastRow[0] === '') {
        resumeKey = lastRow[1];
        rows = result.slice(1, -1) as string[][];
      } else {
        rows = result.slice(1) as string[][];
      }
    }

    // Process results based on includeCaptureCounts
    let siteUrls: SiteUrl[];
    let totalCaptures: number;

    if (params.includeCaptureCounts) {
      // Aggregate by URL
      const urlAggregation = this.aggregateByUrl(rows);
      siteUrls = urlAggregation.urls;
      totalCaptures = urlAggregation.totalCaptures;

      // Apply limit after aggregation
      if (params.limit && siteUrls.length > params.limit) {
        siteUrls = siteUrls.slice(0, params.limit);
      }
    } else {
      // Each row is already unique URL due to collapse=urlkey
      siteUrls = rows.map(row => ({
        url: row[0],
        firstCapture: row[1],
        lastCapture: row[1], // Same as first when collapsed
        captureCount: 1, // Unknown when collapsed
        statusCode: row[2] || '200',
        mimeType: row[3] || 'text/html'
      }));
      totalCaptures = rows.length;

      // Apply limit
      if (params.limit && siteUrls.length > params.limit) {
        siteUrls = siteUrls.slice(0, params.limit);
      }
    }

    // Sort results based on sortBy parameter
    if (params.sortBy) {
      switch (params.sortBy) {
        case 'oldest':
          siteUrls.sort((a, b) => a.firstCapture.localeCompare(b.firstCapture));
          break;
        case 'newest':
          siteUrls.sort((a, b) => b.lastCapture.localeCompare(a.lastCapture));
          break;
        case 'captures':
          siteUrls.sort((a, b) => b.captureCount - a.captureCount);
          break;
        // 'urlkey' is default CDX order, no sort needed
      }
    }

    // Extract subdomains if matchType is domain
    const subdomains = params.matchType === 'domain'
      ? this.extractSubdomains(siteUrls.map(u => u.url), normalizedUrl)
      : [];

    // Filter out subdomains if includeSubdomains is false
    if (params.matchType === 'domain' && !params.includeSubdomains) {
      const baseDomain = normalizedUrl.replace(/^www\./, '');
      siteUrls = siteUrls.filter(u => {
        try {
          const host = new URL(u.url.startsWith('http') ? u.url : `https://${u.url}`).hostname;
          return host === baseDomain || host === `www.${baseDomain}`;
        } catch {
          return true;
        }
      });
    }

    // Analyze path structure
    const pathStructure = this.analyzePathStructure(siteUrls.map(u => u.url));

    // Summarize MIME types
    const mimeTypeSummary = this.summarizeMimeTypes(siteUrls);

    const response: SiteUrlsResponse = {
      url: params.url,
      matchType: params.matchType || 'domain',
      dateRange: {
        from: params.from || '',
        to: params.to || '',
        specified: !!(params.from || params.to)
      },
      totalUrls: siteUrls.length,
      totalCaptures,
      urls: siteUrls,
      subdomains,
      pathStructure,
      mimeTypeSummary,
      truncated: !!resumeKey,
      resumeKey
    };

    cache.set(cacheKey, response, CACHE_TTL.SITE_URLS);

    return response;
  }

  /**
   * Normalize URL for CDX API (strip protocol)
   */
  private normalizeUrlForCdx(url: string): string {
    let normalized = url.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/\/$/, '');
    return normalized;
  }

  /**
   * Aggregate CDX rows by URL to get capture counts
   */
  private aggregateByUrl(rows: string[][]): { urls: SiteUrl[]; totalCaptures: number } {
    interface UrlAggregation {
      timestamps: string[];
      statusCode: string;
      mimeType: string;
    }

    const urlMap = new Map<string, UrlAggregation>();

    for (const row of rows) {
      const [original, timestamp, statuscode, mimetype] = row;
      if (!urlMap.has(original)) {
        urlMap.set(original, {
          timestamps: [],
          statusCode: statuscode || '200',
          mimeType: mimetype || 'text/html'
        });
      }
      urlMap.get(original)!.timestamps.push(timestamp);
    }

    const urls: SiteUrl[] = [];
    let totalCaptures = 0;

    for (const [url, agg] of urlMap) {
      agg.timestamps.sort();
      totalCaptures += agg.timestamps.length;
      urls.push({
        url,
        firstCapture: agg.timestamps[0],
        lastCapture: agg.timestamps[agg.timestamps.length - 1],
        captureCount: agg.timestamps.length,
        statusCode: agg.statusCode,
        mimeType: agg.mimeType
      });
    }

    // Sort by capture count (most captured first)
    urls.sort((a, b) => b.captureCount - a.captureCount);

    return { urls, totalCaptures };
  }

  /**
   * Extract unique subdomains from URLs
   */
  private extractSubdomains(urls: string[], baseDomain: string): string[] {
    const subdomains = new Set<string>();
    const normalizedBase = baseDomain.replace(/^www\./, '');

    for (const urlStr of urls) {
      try {
        const url = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
        const host = url.hostname;

        if (host === normalizedBase) {
          continue; // Root domain
        }

        if (host.endsWith('.' + normalizedBase)) {
          const subdomain = host.slice(0, -(normalizedBase.length + 1));
          // Handle nested subdomains (e.g., "a.b" from "a.b.example.com")
          const parts = subdomain.split('.');
          subdomains.add(parts[parts.length - 1]); // Add the immediate subdomain
        }
      } catch {
        // Skip invalid URLs
      }
    }

    return Array.from(subdomains).sort();
  }

  /**
   * Analyze path structure from URLs
   */
  private analyzePathStructure(urls: string[]): Record<string, number> {
    const structure: Record<string, number> = {};

    for (const urlStr of urls) {
      try {
        const url = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
        const pathParts = url.pathname.split('/').filter(Boolean);
        const topPath = pathParts.length > 0 ? `/${pathParts[0]}/` : '/';
        structure[topPath] = (structure[topPath] || 0) + 1;
      } catch {
        structure['/'] = (structure['/'] || 0) + 1;
      }
    }

    // Sort by count descending
    const sorted = Object.entries(structure)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20); // Top 20 paths

    return Object.fromEntries(sorted);
  }

  /**
   * Summarize MIME types from URLs
   */
  private summarizeMimeTypes(urls: SiteUrl[]): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const url of urls) {
      const mimeType = url.mimeType || 'unknown';
      summary[mimeType] = (summary[mimeType] || 0) + 1;
    }

    // Sort by count descending
    const sorted = Object.entries(summary)
      .sort((a, b) => b[1] - a[1]);

    return Object.fromEntries(sorted);
  }
}
