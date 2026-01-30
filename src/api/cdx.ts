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
  ChangeFrequency
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
}
