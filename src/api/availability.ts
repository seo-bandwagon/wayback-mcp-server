import type { WaybackClient } from './client.js';
import { CACHE_TTL } from '../cache/cache.js';
import { normalizeTimestamp, formatTimestamp } from '../utils/date.js';
import type { AvailabilityQuery, AvailabilityResponse } from '../types/index.js';

interface WaybackAvailabilityApiResponse {
  url?: string;
  archived_snapshots?: {
    closest?: {
      available: boolean;
      url: string;
      timestamp: string;
      status: string;
    };
  };
}

export class AvailabilityApi {
  private client: WaybackClient;

  constructor(client: WaybackClient) {
    this.client = client;
  }

  /**
   * Check if a URL is archived in the Wayback Machine
   */
  async checkAvailability(params: AvailabilityQuery): Promise<AvailabilityResponse> {
    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('availability', {
      url: params.url,
      timestamp: params.timestamp
    });

    // Check cache
    const cached = cache.get<AvailabilityResponse>(cacheKey);
    if (cached) return cached;

    // Build URL
    const apiUrl = new URL(this.client.AVAILABILITY_API);
    apiUrl.searchParams.set('url', params.url);
    if (params.timestamp) {
      apiUrl.searchParams.set('timestamp', normalizeTimestamp(params.timestamp));
    }

    // Fetch
    const result = await this.client.withRetry(async () => {
      return this.client.fetchJson<WaybackAvailabilityApiResponse>(apiUrl.toString());
    }, 'available');

    // Transform response
    const response: AvailabilityResponse = {
      url: params.url,
      isArchived: !!(result.archived_snapshots?.closest?.available),
      archiveOrgUrl: `https://web.archive.org/web/*/${params.url}`
    };

    if (result.archived_snapshots?.closest) {
      const snapshot = result.archived_snapshots.closest;
      response.closestSnapshot = {
        url: snapshot.url,
        timestamp: snapshot.timestamp,
        formattedDate: formatTimestamp(snapshot.timestamp),
        status: snapshot.status
      };
    }

    // Cache
    cache.set(cacheKey, response, CACHE_TTL.AVAILABILITY);

    return response;
  }

  /**
   * Check availability for multiple URLs (with rate limiting)
   */
  async checkBulkAvailability(
    urls: string[],
    timestamp?: string
  ): Promise<Map<string, AvailabilityResponse>> {
    const results = new Map<string, AvailabilityResponse>();

    for (const url of urls) {
      try {
        const result = await this.checkAvailability({ url, timestamp });
        results.set(url, result);
      } catch (error) {
        // Store error state for this URL
        results.set(url, {
          url,
          isArchived: false,
          archiveOrgUrl: `https://web.archive.org/web/*/${url}`
        });
      }
    }

    return results;
  }
}
