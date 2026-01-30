import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface CacheEntry {
  data: string;
  timestamp: number;
  ttl: number;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

export class Cache {
  private store: CacheStore = {};
  private filePath: string;
  private initialized = false;

  constructor(filePath: string) {
    this.filePath = filePath.replace(/\.db$/, '.json');
  }

  initialize(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.filePath)) {
      try {
        const data = readFileSync(this.filePath, 'utf-8');
        this.store = JSON.parse(data);
      } catch {
        this.store = {};
      }
    }

    this.initialized = true;
    this.cleanup();
  }

  close(): void {
    if (this.initialized) {
      this.save();
    }
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  get<T>(key: string): T | null {
    this.ensureInitialized();

    const entry = this.store[key];
    if (!entry) {
      return null;
    }

    if (entry.timestamp + entry.ttl * 1000 < Date.now()) {
      this.delete(key);
      return null;
    }

    try {
      return JSON.parse(entry.data) as T;
    } catch {
      this.delete(key);
      return null;
    }
  }

  set<T>(key: string, data: T, ttl?: number): void {
    this.ensureInitialized();

    this.store[key] = {
      data: JSON.stringify(data),
      timestamp: Date.now(),
      ttl: ttl || 3600
    };

    this.save();
  }

  delete(key: string): void {
    this.ensureInitialized();
    delete this.store[key];
    this.save();
  }

  clear(): void {
    this.ensureInitialized();
    this.store = {};
    this.save();
  }

  cleanup(): void {
    this.ensureInitialized();

    const now = Date.now();
    let changed = false;

    for (const key of Object.keys(this.store)) {
      const entry = this.store[key];
      if (entry.timestamp + entry.ttl * 1000 < now) {
        delete this.store[key];
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }
  }

  generateKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        if (params[key] !== undefined) {
          acc[key] = params[key];
        }
        return acc;
      }, {} as Record<string, unknown>);

    return `${prefix}:${JSON.stringify(sortedParams)}`;
  }
}

// Cache TTL constants (in seconds) for Wayback Machine
export const CACHE_TTL = {
  AVAILABILITY: 3600,        // 1 hour - availability status can change
  SNAPSHOTS: 86400,          // 24 hours - historical snapshot list is stable
  SNAPSHOT_CONTENT: 604800,  // 7 days - archived content is immutable
  CDX_QUERIES: 43200,        // 12 hours - snapshot lists rarely change
  BULK_CHECK: 3600           // 1 hour - for bulk availability checks
};
