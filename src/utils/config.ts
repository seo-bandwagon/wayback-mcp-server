import { homedir } from 'os';
import { join } from 'path';
import type { WaybackConfig } from '../types/index.js';

export function getConfig(): WaybackConfig {
  const home = homedir();

  return {
    cachePath: process.env.WAYBACK_CACHE_PATH || join(home, '.wayback-mcp', 'cache.json'),
    cacheTtl: parseInt(process.env.WAYBACK_CACHE_TTL || '3600', 10),
    logLevel: (process.env.WAYBACK_LOG_LEVEL as WaybackConfig['logLevel']) || 'info'
  };
}
