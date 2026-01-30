import type { WaybackClient } from './client.js';
import { CACHE_TTL } from '../cache/cache.js';
import { normalizeTimestamp, formatTimestamp } from '../utils/date.js';
import type { AvailabilityQuery, AvailabilityResponse } from '../types/index.js';
import { WaybackApiError, ERROR_CODES } from '../types/index.js';

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

    // Build URL for Availability API
    const apiUrl = new URL(this.client.AVAILABILITY_API);
    apiUrl.searchParams.set('url', url);
    if (timestamp) {
      apiUrl.searchParams.set('timestamp', normalizeTimestamp(timestamp));
    }

    // Fetch from Availability API
    const result = await this.client.withRetry(async () => {
      return this.client.fetchJson<WaybackAvailabilityApiResponse>(apiUrl.toString());
    }, 'available');

    // Transform response
    let response: AvailabilityResponse = {
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

    // FALLBACK: If Availability API returns no results, check CDX API
    // The Availability API can have false negatives for some older sites
    if (!response.isArchived) {
      const cdxResult = await this.checkCdxFallback(url, timestamp);
      if (cdxResult) {
        response = cdxResult;
      }
    }

    // Cache
    cache.set(cacheKey, response, CACHE_TTL.AVAILABILITY);

    return response;
  }

  /**
   * Fallback to CDX API when Availability API returns no results
   * This catches cases where older archives exist but Availability API doesn't return them
   */
  private async checkCdxFallback(url: string, timestamp?: string): Promise<AvailabilityResponse | null> {
    try {
      // Strip protocol for CDX query
      const normalizedUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');

      const cdxUrl = new URL(this.client.CDX_API);
      cdxUrl.searchParams.set('url', normalizedUrl);
      cdxUrl.searchParams.set('output', 'json');
      cdxUrl.searchParams.set('limit', '1');
      cdxUrl.searchParams.set('fl', 'timestamp,original,statuscode');
      cdxUrl.searchParams.set('filter', 'statuscode:200');

      // If timestamp provided, sort by closest to that timestamp
      if (timestamp) {
        cdxUrl.searchParams.set('closest', normalizeTimestamp(timestamp));
        cdxUrl.searchParams.set('sort', 'closest');
      }

      const result = await this.client.withRetry(async () => {
        const response = await this.client.fetch(cdxUrl.toString());
        const text = await response.text();
        if (!text.trim()) return [];
        try {
          return JSON.parse(text);
        } catch {
          return [];
        }
      }, 'cdx');

      // CDX returns array with header row first
      if (Array.isArray(result) && result.length > 1) {
        const [, dataRow] = result;
        if (Array.isArray(dataRow) && dataRow.length >= 2) {
          const [ts, original, statusCode] = dataRow;
          const waybackUrl = `https://web.archive.org/web/${ts}/${original}`;

          return {
            url,
            isArchived: true,
            closestSnapshot: {
              url: waybackUrl,
              timestamp: ts,
              formattedDate: formatTimestamp(ts),
              status: statusCode || '200'
            },
            archiveOrgUrl: `https://web.archive.org/web/*/${url}`
          };
        }
      }

      return null;
    } catch {
      // CDX fallback failed, return null to use original response
      return null;
    }
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
