import { z } from 'zod';

// ============================================
// Availability API Types
// ============================================

export const AvailabilityQuerySchema = z.object({
  url: z.string().url(),
  timestamp: z.string().optional(),
  checkWwwVariant: z.boolean().optional().default(true)
});

export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export interface AvailabilityResponse {
  url: string;
  isArchived: boolean;
  closestSnapshot?: {
    url: string;
    timestamp: string;
    formattedDate: string;
    status: string;
  };
  archiveOrgUrl: string;
  checkedVariant?: string;
}

// ============================================
// CDX / Snapshots Types
// ============================================

export const MatchTypeSchema = z.enum(['exact', 'prefix', 'host', 'domain']);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const StatusFilterSchema = z.enum(['200', '2xx', '3xx', '4xx', '5xx', 'all']);
export type StatusFilter = z.infer<typeof StatusFilterSchema>;

export const CollapseSchema = z.enum(['none', 'daily', 'monthly', 'yearly', 'digest']);
export type Collapse = z.infer<typeof CollapseSchema>;

export const SnapshotsQuerySchema = z.object({
  url: z.string(),
  matchType: MatchTypeSchema.optional().default('exact'),
  from: z.string().optional(),
  to: z.string().optional(),
  statusFilter: StatusFilterSchema.optional().default('200'),
  collapse: CollapseSchema.optional().default('none'),
  limit: z.number().min(1).max(10000).optional().default(100)
});

export type SnapshotsQuery = z.infer<typeof SnapshotsQuerySchema>;

export interface Snapshot {
  timestamp: string;
  formattedDate: string;
  originalUrl: string;
  mimeType: string;
  statusCode: number;
  digest: string;
  length: number;
  waybackUrl: string;
  rawUrl: string;
}

export interface SnapshotsResponse {
  url: string;
  totalSnapshots: number;
  dateRange: {
    first: string;
    last: string;
  };
  snapshots: Snapshot[];
}

// ============================================
// Snapshot Content Types
// ============================================

export const SnapshotContentQuerySchema = z.object({
  url: z.string(),
  timestamp: z.string(),
  extractMetadata: z.boolean().optional().default(true),
  includeRawHtml: z.boolean().optional().default(false),
  maxContentLength: z.number().optional().default(50000)
});

export type SnapshotContentQuery = z.infer<typeof SnapshotContentQuerySchema>;

export interface SnapshotMetadata {
  title: string;
  metaDescription: string;
  metaKeywords: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  h1: string[];
  h2: string[];
  robots: string;
  wordCount: number;
  linkCount: {
    internal: number;
    external: number;
  };
}

export interface SnapshotContentResponse {
  url: string;
  timestamp: string;
  formattedDate: string;
  waybackUrl: string;
  statusCode: number;
  contentLength: number;
  metadata?: SnapshotMetadata;
  textContent?: string;
  rawHtml?: string;
  requestedTimestamp?: string;
  note?: string;
}

// ============================================
// Compare Snapshots Types
// ============================================

export const CompareElementSchema = z.enum(['title', 'description', 'headings', 'content', 'links', 'structure', 'all']);
export type CompareElement = z.infer<typeof CompareElementSchema>;

export const CompareSnapshotsQuerySchema = z.object({
  url: z.string(),
  timestamp1: z.string(),
  timestamp2: z.string(),
  compareElements: z.array(CompareElementSchema).optional().default(['all']),
  showDiff: z.boolean().optional().default(true)
});

export type CompareSnapshotsQuery = z.infer<typeof CompareSnapshotsQuerySchema>;

export interface ChangeDetail<T = string> {
  changed: boolean;
  before: T;
  after: T;
}

export interface HeadingsChange {
  h1Changed: boolean;
  h2Changed: boolean;
  before: { h1: string[]; h2: string[] };
  after: { h1: string[]; h2: string[] };
}

export interface ContentChange {
  changed: boolean;
  wordCountBefore: number;
  wordCountAfter: number;
  wordCountDelta: number;
  percentChange: number;
  addedSections: string[];
  removedSections: string[];
  diff?: string;
}

export interface LinksChange {
  changed: boolean;
  addedLinks: string[];
  removedLinks: string[];
  internalDelta: number;
  externalDelta: number;
}

export interface StructureChange {
  changed: boolean;
  schemaMarkupBefore: string[];
  schemaMarkupAfter: string[];
  canonicalChanged: boolean;
  robotsChanged: boolean;
}

export interface CompareSnapshotsResponse {
  url: string;
  snapshot1: {
    timestamp: string;
    formattedDate: string;
  };
  snapshot2: {
    timestamp: string;
    formattedDate: string;
  };
  daysBetween: number;
  hasChanges: boolean;
  changes: {
    title?: ChangeDetail;
    metaDescription?: ChangeDetail;
    headings?: HeadingsChange;
    content?: ContentChange;
    links?: LinksChange;
    structure?: StructureChange;
  };
  summary: string;
}

// ============================================
// Bulk Check Types
// ============================================

export const BulkCheckQuerySchema = z.object({
  urls: z.array(z.string()).min(1).max(50),
  timestamp: z.string().optional(),
  includeSnapshotCount: z.boolean().optional().default(false),
  checkWwwVariant: z.boolean().optional().default(true)
});

export type BulkCheckQuery = z.infer<typeof BulkCheckQuerySchema>;

export interface BulkCheckResult {
  url: string;
  isArchived: boolean;
  closestSnapshot?: {
    timestamp: string;
    formattedDate: string;
    waybackUrl: string;
  };
  snapshotCount?: number;
  checkedVariant?: string;
  error?: string;
}

export interface BulkCheckResponse {
  totalUrls: number;
  archivedCount: number;
  notArchivedCount: number;
  results: BulkCheckResult[];
  summary: {
    archiveRate: number;
    oldestSnapshot: string;
    newestSnapshot: string;
  };
}

// ============================================
// Changes Timeline Types
// ============================================

export const GranularitySchema = z.enum(['daily', 'weekly', 'monthly']);
export type Granularity = z.infer<typeof GranularitySchema>;

export const ChangesTimelineQuerySchema = z.object({
  url: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  granularity: GranularitySchema.optional().default('monthly'),
  includeMetadataChanges: z.boolean().optional().default(false)
});

export type ChangesTimelineQuery = z.infer<typeof ChangesTimelineQuerySchema>;

export interface ChangeEvent {
  timestamp: string;
  formattedDate: string;
  previousTimestamp: string;
  daysSincePrevious: number;
  changeType: 'content' | 'metadata' | 'both' | 'unknown';
  digestBefore: string;
  digestAfter: string;
  metadataChanges?: {
    titleChanged: boolean;
    descriptionChanged: boolean;
  };
  waybackUrl: string;
}

export type ChangeFrequency = 'very_frequent' | 'frequent' | 'moderate' | 'infrequent' | 'rare';

export interface ChangesTimelineResponse {
  url: string;
  dateRange: {
    from: string;
    to: string;
  };
  totalSnapshots: number;
  totalChanges: number;
  changeEvents: ChangeEvent[];
  summary: {
    averageTimeBetweenChanges: string;
    mostActiveMonth: string;
    changeFrequency: ChangeFrequency;
  };
}

// ============================================
// Analyze Changes Types
// ============================================

export const AnalysisDepthSchema = z.enum(['quick', 'standard', 'deep']);
export type AnalysisDepth = z.infer<typeof AnalysisDepthSchema>;

export const AnalyzeChangesQuerySchema = z.object({
  url: z.string(),
  beforeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  afterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  analysisDepth: AnalysisDepthSchema.optional().default('standard')
});

export type AnalyzeChangesQuery = z.infer<typeof AnalyzeChangesQuerySchema>;

export type ImpactType = 'positive' | 'negative' | 'neutral' | 'mixed';
export type AssessmentType = 'improved' | 'degraded' | 'neutral' | 'unchanged';

export interface AnalysisChangeDetail {
  changed: boolean;
  before: string | string[] | number;
  after: string | string[] | number;
  assessment: AssessmentType;
}

export interface SEOImpactAnalysis {
  overallImpact: ImpactType;
  impactScore: number;
  criticalChanges: string[];
  potentialIssues: string[];
  improvements: string[];
}

export interface AnalyzeChangesResponse {
  url: string;
  beforeSnapshot: {
    timestamp: string;
    formattedDate: string;
    requestedDate: string;
    daysFromRequested: number;
  };
  afterSnapshot: {
    timestamp: string;
    formattedDate: string;
    requestedDate: string;
    daysFromRequested: number;
  };
  seoImpactAnalysis: SEOImpactAnalysis;
  changes: {
    title: AnalysisChangeDetail;
    metaDescription: AnalysisChangeDetail;
    h1: AnalysisChangeDetail;
    contentLength: {
      before: number;
      after: number;
      delta: number;
      percentChange: number;
    };
    internalLinks: AnalysisChangeDetail;
    externalLinks: AnalysisChangeDetail;
    structuredData: AnalysisChangeDetail;
    canonical: AnalysisChangeDetail;
    robots: AnalysisChangeDetail;
  };
  recommendations: string[];
  correlationNotes: string;
}

// ============================================
// Site URLs Types
// ============================================

export const SiteUrlsQuerySchema = z.object({
  url: z.string(),
  matchType: MatchTypeSchema.optional().default('domain'),
  from: z.string().optional(),
  to: z.string().optional(),
  statusFilter: StatusFilterSchema.optional().default('200'),
  limit: z.number().min(1).max(10000).optional().default(1000),
  includeSubdomains: z.boolean().optional().default(true),
  includeCaptureCounts: z.boolean().optional().default(false),
  mimeTypeFilter: z.string().optional()
});

export type SiteUrlsQuery = z.infer<typeof SiteUrlsQuerySchema>;

export interface SiteUrl {
  url: string;
  firstCapture: string;
  lastCapture: string;
  captureCount: number;
  statusCode: string;
  mimeType: string;
}

export interface SiteUrlsResponse {
  url: string;
  matchType: string;
  dateRange: {
    from: string;
    to: string;
    specified: boolean;
  };
  totalUrls: number;
  totalCaptures: number;
  urls: SiteUrl[];
  subdomains: string[];
  pathStructure: Record<string, number>;
  mimeTypeSummary: Record<string, number>;
  truncated?: boolean;
  resumeKey?: string;
}

// ============================================
// Error Types
// ============================================

export interface WaybackError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class WaybackApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(error: WaybackError) {
    super(error.message);
    this.name = 'WaybackApiError';
    this.code = error.code;
    this.details = error.details;
  }
}

export const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_URL: 'INVALID_URL',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  FETCH_FAILED: 'FETCH_FAILED',
  PARSE_ERROR: 'PARSE_ERROR',
  API_ERROR: 'API_ERROR',
  TIMEOUT: 'TIMEOUT'
} as const;

// ============================================
// Config Types
// ============================================

export interface WaybackConfig {
  cachePath: string;
  cacheTtl: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ============================================
// Parsed HTML Content Types
// ============================================

export interface ParsedContent {
  title: string;
  metaDescription: string;
  metaKeywords: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  h1: string[];
  h2: string[];
  robots: string;
  textContent: string;
  links: ParsedLink[];
  structuredData: object[];
  wordCount: number;
}

export interface ParsedLink {
  href: string;
  isExternal: boolean;
}
