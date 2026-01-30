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
    // First, check the primary URL
    const response = await this.checkAvailabilityInternal(params.url, params.timestamp);

    // If not found and checkWwwVariant is enabled (default: true), try alternate
    if (!response.isArchived && params.checkWwwVariant !== false) {
      const alternateUrl = this.getWwwVariant(params.url);
      if (alternateUrl) {
        const alternateResult = await this.checkAvailabilityInternal(alternateUrl, params.timestamp);
        if (alternateResult.isArchived) {
          // Return result with original URL but indicate which variant was found
          return {
            ...alternateResult,
            url: params.url,
            archiveOrgUrl: `https://web.archive.org/web/*/${params.url}`,
            checkedVariant: alternateUrl
          };
        }
      }
    }

    return response;
  }

  /**
   * Internal method to check availability for a single URL (no www variant checking)
   */
  private async checkAvailabilityInternal(url: string, timestamp?: string): Promise<AvailabilityResponse> {
    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('availability', { url, timestamp });

    // Check cache
    const cached = cache.get<AvailabilityResponse>(cacheKey);
    if (cached) return cached;

    // Build URL
    const apiUrl = new URL(this.client.AVAILABILITY_API);
    apiUrl.searchParams.set('url', url);
    if (timestamp) {
      apiUrl.searchParams.set('timestamp', normalizeTimestamp(timestamp));
    }

    // Fetch
    const result = await this.client.withRetry(async () => {
      return this.client.fetchJson<WaybackAvailabilityApiResponse>(apiUrl.toString());
    }, 'available');

    // Transform response
    const response: AvailabilityResponse = {
      url,
      isArchived: !!(result.archived_snapshots?.closest?.available),
      archiveOrgUrl: `https://web.archive.org/web/*/${url}`
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
   * Get the www variant of a URL (add or remove www prefix)
   */
  private getWwwVariant(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.startsWith('www.')) {
        // Remove www
        parsed.hostname = parsed.hostname.slice(4);
      } else {
        // Add www
        parsed.hostname = 'www.' + parsed.hostname;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  }

  /**
   * Check availability for multiple URLs (with rate limiting)
   */
  async checkBulkAvailability(
    urls: string[],
    timestamp?: string,
    checkWwwVariant: boolean = true
  ): Promise<Map<string, AvailabilityResponse>> {
    const results = new Map<string, AvailabilityResponse>();

    for (const url of urls) {
      try {
        const result = await this.checkAvailability({ url, timestamp, checkWwwVariant });
        results.set(url, result);
      } catch {
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
