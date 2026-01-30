import { RateLimiter } from '../utils/rate-limiter.js';
import { Cache } from '../cache/cache.js';
import { WaybackApiError, ERROR_CODES } from '../types/index.js';
import type { WaybackConfig } from '../types/index.js';

export class WaybackClient {
  private rateLimiter: RateLimiter;
  private cache: Cache;
  private config: WaybackConfig;

  // Base URLs for different Wayback Machine APIs
  readonly AVAILABILITY_API = 'https://archive.org/wayback/available';
  readonly CDX_API = 'https://web.archive.org/cdx/search/cdx';
  readonly SNAPSHOT_BASE = 'https://web.archive.org/web';

  constructor(config: WaybackConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter();
    this.cache = new Cache(config.cachePath);
  }

  async initialize(): Promise<void> {
    this.cache.initialize();
  }

  async close(): Promise<void> {
    this.cache.close();
  }

  getCache(): Cache {
    return this.cache;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Execute an operation with retry logic and rate limiting
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    endpoint: string,
    maxRetries = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.rateLimiter.acquire(endpoint);
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;

        // Handle HTTP errors
        if (this.isHttpError(error)) {
          const status = error.status;

          // Rate limit (429) or Service Unavailable (503) - wait and retry
          if (status === 429 || status === 503) {
            const waitTime = Math.pow(2, attempt) * 2000;
            console.error(`Rate limited/unavailable (${status}). Waiting ${waitTime}ms...`);
            await this.sleep(waitTime);
            continue;
          }

          // Not found - no retry needed
          if (status === 404) {
            throw new WaybackApiError({
              code: ERROR_CODES.NOT_FOUND,
              message: 'URL not found in Wayback Machine',
              details: { status }
            });
          }

          // Server error - retry with backoff
          if (status >= 500) {
            if (attempt < maxRetries - 1) {
              const waitTime = Math.pow(2, attempt) * 1000;
              console.error(`Server error (${status}). Retrying in ${waitTime}ms...`);
              await this.sleep(waitTime);
              continue;
            }
          }

          // Other HTTP errors
          throw new WaybackApiError({
            code: ERROR_CODES.API_ERROR,
            message: `HTTP error: ${status}`,
            details: { status }
          });
        }

        // Network or unknown errors - retry with backoff
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.error(`Request failed. Retrying in ${waitTime}ms...`);
          await this.sleep(waitTime);
          continue;
        }
      }
    }

    throw lastError || new Error('Unknown error occurred');
  }

  /**
   * Fetch with proper User-Agent header
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'WaybackMCP/1.0 (SEO Analysis Tool; MCP Server)',
        'Accept': 'application/json, text/html, */*',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw { status: response.status, message: response.statusText };
    }

    return response;
  }

  /**
   * Fetch JSON from an endpoint
   */
  async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetch(url);
    return response.json() as Promise<T>;
  }

  /**
   * Fetch text/HTML from an endpoint
   */
  async fetchText(url: string): Promise<string> {
    const response = await this.fetch(url);
    return response.text();
  }

  /**
   * Build a Wayback URL for a snapshot
   */
  getSnapshotUrl(timestamp: string, url: string): string {
    return `${this.SNAPSHOT_BASE}/${timestamp}/${url}`;
  }

  /**
   * Build a raw Wayback URL (without toolbar)
   */
  getRawSnapshotUrl(timestamp: string, url: string): string {
    return `${this.SNAPSHOT_BASE}/${timestamp}id_/${url}`;
  }

  private isHttpError(error: unknown): error is { status: number; message: string } {
    return typeof error === 'object' && error !== null && 'status' in error;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
