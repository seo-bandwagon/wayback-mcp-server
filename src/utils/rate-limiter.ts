interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RequestRecord {
  timestamps: number[];
}

// Conservative rate limits for archive.org (be respectful)
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'availability': {
    maxRequests: 15,
    windowMs: 60 * 1000  // 15 per minute
  },
  'cdx': {
    maxRequests: 10,
    windowMs: 60 * 1000  // 10 per minute (CDX queries are heavier)
  },
  'content': {
    maxRequests: 5,
    windowMs: 60 * 1000  // 5 per minute (full page fetches)
  },
  'default': {
    maxRequests: 10,
    windowMs: 60 * 1000
  }
};

export class RateLimiter {
  private requests: Map<string, RequestRecord> = new Map();

  async acquire(endpoint: string): Promise<void> {
    const category = this.getCategory(endpoint);
    const config = RATE_LIMITS[category] || RATE_LIMITS['default'];

    const record = this.requests.get(category) || { timestamps: [] };
    const now = Date.now();

    // Remove expired timestamps
    record.timestamps = record.timestamps.filter(
      (ts) => ts > now - config.windowMs
    );

    // Check if we're at the limit
    if (record.timestamps.length >= config.maxRequests) {
      const oldestTimestamp = record.timestamps[0];
      const waitTime = oldestTimestamp + config.windowMs - now;

      if (waitTime > 0) {
        console.error(`Rate limit reached for ${category}. Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await this.sleep(waitTime);
        return this.acquire(endpoint);
      }
    }

    // Record this request
    record.timestamps.push(now);
    this.requests.set(category, record);
  }

  private getCategory(endpoint: string): string {
    if (endpoint.includes('available')) return 'availability';
    if (endpoint.includes('cdx')) return 'cdx';
    if (endpoint.includes('web/')) return 'content';
    return 'default';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRemainingRequests(endpoint: string): number {
    const category = this.getCategory(endpoint);
    const config = RATE_LIMITS[category] || RATE_LIMITS['default'];
    const record = this.requests.get(category);

    if (!record) {
      return config.maxRequests;
    }

    const now = Date.now();
    const validTimestamps = record.timestamps.filter(
      (ts) => ts > now - config.windowMs
    );

    return Math.max(0, config.maxRequests - validTimestamps.length);
  }

  getResetTime(endpoint: string): number | null {
    const category = this.getCategory(endpoint);
    const config = RATE_LIMITS[category] || RATE_LIMITS['default'];
    const record = this.requests.get(category);

    if (!record || record.timestamps.length === 0) {
      return null;
    }

    const oldestTimestamp = Math.min(...record.timestamps);
    return oldestTimestamp + config.windowMs;
  }
}
