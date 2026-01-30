import * as diff from 'diff';
import type { WaybackClient } from './client.js';
import { CdxApi } from './cdx.js';
import { SnapshotsApi } from './snapshots.js';
import { daysBetween, normalizeTimestamp, formatTimestamp } from '../utils/date.js';
import { arraysEqual, getStructuredDataTypes, truncateText } from '../utils/html-parser.js';
import type {
  CompareSnapshotsQuery,
  CompareSnapshotsResponse,
  ChangeDetail,
  HeadingsChange,
  ContentChange,
  LinksChange,
  StructureChange,
  AnalyzeChangesQuery,
  AnalyzeChangesResponse,
  AnalysisChangeDetail,
  SEOImpactAnalysis,
  AssessmentType,
  ImpactType,
  ParsedContent
} from '../types/index.js';

export class DiffService {
  private client: WaybackClient;
  private cdxApi: CdxApi;
  private snapshotsApi: SnapshotsApi;

  constructor(client: WaybackClient) {
    this.client = client;
    this.cdxApi = new CdxApi(client);
    this.snapshotsApi = new SnapshotsApi(client);
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(params: CompareSnapshotsQuery): Promise<CompareSnapshotsResponse> {
    // Fetch both snapshots
    const [content1, content2] = await Promise.all([
      this.snapshotsApi.getParsedContent(params.url, params.timestamp1),
      this.snapshotsApi.getParsedContent(params.url, params.timestamp2)
    ]);

    const compareAll = params.compareElements?.includes('all') ?? true;
    const changes: CompareSnapshotsResponse['changes'] = {};

    // Compare title
    if (compareAll || params.compareElements?.includes('title')) {
      if (content1.title !== content2.title) {
        changes.title = {
          changed: true,
          before: content1.title,
          after: content2.title
        };
      }
    }

    // Compare meta description
    if (compareAll || params.compareElements?.includes('description')) {
      if (content1.metaDescription !== content2.metaDescription) {
        changes.metaDescription = {
          changed: true,
          before: content1.metaDescription,
          after: content2.metaDescription
        };
      }
    }

    // Compare headings
    if (compareAll || params.compareElements?.includes('headings')) {
      const h1Changed = !arraysEqual(content1.h1, content2.h1);
      const h2Changed = !arraysEqual(content1.h2, content2.h2);

      if (h1Changed || h2Changed) {
        changes.headings = {
          h1Changed,
          h2Changed,
          before: { h1: content1.h1, h2: content1.h2 },
          after: { h1: content2.h1, h2: content2.h2 }
        };
      }
    }

    // Compare content
    if (compareAll || params.compareElements?.includes('content')) {
      changes.content = this.compareContent(
        content1.textContent,
        content2.textContent,
        params.showDiff ?? true
      );
    }

    // Compare links
    if (compareAll || params.compareElements?.includes('links')) {
      changes.links = this.compareLinks(content1, content2);
    }

    // Compare structure
    if (compareAll || params.compareElements?.includes('structure')) {
      changes.structure = this.compareStructure(content1, content2);
    }

    const hasChanges = Object.keys(changes).length > 0;
    const days = daysBetween(params.timestamp1, params.timestamp2);

    return {
      url: params.url,
      snapshot1: {
        timestamp: params.timestamp1,
        formattedDate: formatTimestamp(params.timestamp1)
      },
      snapshot2: {
        timestamp: params.timestamp2,
        formattedDate: formatTimestamp(params.timestamp2)
      },
      daysBetween: days,
      hasChanges,
      changes,
      summary: this.generateSummary(changes, days)
    };
  }

  /**
   * Analyze changes between two dates with SEO impact assessment
   */
  async analyzeChanges(params: AnalyzeChangesQuery): Promise<AnalyzeChangesResponse> {
    // Find closest snapshots to the requested dates
    const beforeTs = normalizeTimestamp(params.beforeDate);
    const afterTs = normalizeTimestamp(params.afterDate);

    const [beforeSnapshot, afterSnapshot] = await Promise.all([
      this.cdxApi.findClosestSnapshot(params.url, beforeTs),
      this.cdxApi.findClosestSnapshot(params.url, afterTs)
    ]);

    if (!beforeSnapshot || !afterSnapshot) {
      throw new Error('Could not find snapshots near the requested dates');
    }

    // Fetch content for both snapshots
    const [beforeContent, afterContent] = await Promise.all([
      this.snapshotsApi.getParsedContent(params.url, beforeSnapshot.timestamp),
      this.snapshotsApi.getParsedContent(params.url, afterSnapshot.timestamp)
    ]);

    // Build detailed change analysis
    const changes = this.buildDetailedChanges(beforeContent, afterContent);

    // Generate SEO impact analysis
    const seoImpactAnalysis = this.analyzeSEOImpact(beforeContent, afterContent, changes);

    // Calculate days from requested dates
    const beforeDays = daysBetween(beforeTs, beforeSnapshot.timestamp);
    const afterDays = daysBetween(afterTs, afterSnapshot.timestamp);

    return {
      url: params.url,
      beforeSnapshot: {
        timestamp: beforeSnapshot.timestamp,
        formattedDate: formatTimestamp(beforeSnapshot.timestamp),
        requestedDate: params.beforeDate,
        daysFromRequested: beforeDays
      },
      afterSnapshot: {
        timestamp: afterSnapshot.timestamp,
        formattedDate: formatTimestamp(afterSnapshot.timestamp),
        requestedDate: params.afterDate,
        daysFromRequested: afterDays
      },
      seoImpactAnalysis,
      changes,
      recommendations: this.generateRecommendations(changes, seoImpactAnalysis),
      correlationNotes: this.generateCorrelationNotes(changes, seoImpactAnalysis)
    };
  }

  /**
   * Compare text content and generate diff
   */
  private compareContent(before: string, after: string, showDiff: boolean): ContentChange {
    const wordsBefore = this.countWords(before);
    const wordsAfter = this.countWords(after);
    const wordDelta = wordsAfter - wordsBefore;
    const percentChange = wordsBefore > 0 ? (wordDelta / wordsBefore) * 100 : 0;

    const result: ContentChange = {
      changed: before !== after,
      wordCountBefore: wordsBefore,
      wordCountAfter: wordsAfter,
      wordCountDelta: wordDelta,
      percentChange: Math.round(percentChange * 100) / 100,
      addedSections: [],
      removedSections: []
    };

    if (showDiff && before !== after) {
      // Generate unified diff
      result.diff = diff.createPatch(
        'content',
        before,
        after,
        'before',
        'after',
        { context: 3 }
      );

      // Extract significant added/removed sections
      const lineChanges = diff.diffLines(before, after);
      for (const change of lineChanges) {
        if (change.added && change.value.trim().length > 50) {
          result.addedSections.push(truncateText(change.value.trim(), 200));
        }
        if (change.removed && change.value.trim().length > 50) {
          result.removedSections.push(truncateText(change.value.trim(), 200));
        }
      }

      // Limit sections
      result.addedSections = result.addedSections.slice(0, 5);
      result.removedSections = result.removedSections.slice(0, 5);
    }

    return result;
  }

  /**
   * Compare links between two versions
   */
  private compareLinks(before: ParsedContent, after: ParsedContent): LinksChange {
    const beforeHrefs = new Set(before.links.map(l => l.href));
    const afterHrefs = new Set(after.links.map(l => l.href));

    const addedLinks = [...afterHrefs].filter(h => !beforeHrefs.has(h));
    const removedLinks = [...beforeHrefs].filter(h => !afterHrefs.has(h));

    const beforeInternal = before.links.filter(l => !l.isExternal).length;
    const afterInternal = after.links.filter(l => !l.isExternal).length;
    const beforeExternal = before.links.filter(l => l.isExternal).length;
    const afterExternal = after.links.filter(l => l.isExternal).length;

    return {
      changed: addedLinks.length > 0 || removedLinks.length > 0,
      addedLinks: addedLinks.slice(0, 10),
      removedLinks: removedLinks.slice(0, 10),
      internalDelta: afterInternal - beforeInternal,
      externalDelta: afterExternal - beforeExternal
    };
  }

  /**
   * Compare structural elements
   */
  private compareStructure(before: ParsedContent, after: ParsedContent): StructureChange {
    const beforeTypes = getStructuredDataTypes(before.structuredData);
    const afterTypes = getStructuredDataTypes(after.structuredData);

    return {
      changed: before.canonicalUrl !== after.canonicalUrl ||
               before.robots !== after.robots ||
               !arraysEqual(beforeTypes, afterTypes),
      schemaMarkupBefore: beforeTypes,
      schemaMarkupAfter: afterTypes,
      canonicalChanged: before.canonicalUrl !== after.canonicalUrl,
      robotsChanged: before.robots !== after.robots
    };
  }

  /**
   * Build detailed change analysis for SEO
   */
  private buildDetailedChanges(before: ParsedContent, after: ParsedContent): AnalyzeChangesResponse['changes'] {
    const beforeInternal = before.links.filter(l => !l.isExternal).length;
    const afterInternal = after.links.filter(l => !l.isExternal).length;
    const beforeExternal = before.links.filter(l => l.isExternal).length;
    const afterExternal = after.links.filter(l => l.isExternal).length;

    const beforeTypes = getStructuredDataTypes(before.structuredData);
    const afterTypes = getStructuredDataTypes(after.structuredData);

    return {
      title: this.createAnalysisChangeDetail(before.title, after.title),
      metaDescription: this.createAnalysisChangeDetail(before.metaDescription, after.metaDescription),
      h1: this.createAnalysisChangeDetail(before.h1, after.h1),
      contentLength: {
        before: before.wordCount,
        after: after.wordCount,
        delta: after.wordCount - before.wordCount,
        percentChange: before.wordCount > 0
          ? Math.round(((after.wordCount - before.wordCount) / before.wordCount) * 10000) / 100
          : 0
      },
      internalLinks: this.createAnalysisChangeDetail(beforeInternal, afterInternal),
      externalLinks: this.createAnalysisChangeDetail(beforeExternal, afterExternal),
      structuredData: this.createAnalysisChangeDetail(beforeTypes, afterTypes),
      canonical: this.createAnalysisChangeDetail(before.canonicalUrl, after.canonicalUrl),
      robots: this.createAnalysisChangeDetail(before.robots, after.robots)
    };
  }

  /**
   * Create an analysis change detail with assessment
   */
  private createAnalysisChangeDetail(before: string | string[] | number, after: string | string[] | number): AnalysisChangeDetail {
    const changed = JSON.stringify(before) !== JSON.stringify(after);

    let assessment: AssessmentType = 'unchanged';
    if (changed) {
      if (typeof before === 'number' && typeof after === 'number') {
        assessment = after > before ? 'improved' : 'degraded';
      } else if (Array.isArray(before) && Array.isArray(after)) {
        assessment = after.length >= before.length ? 'neutral' : 'degraded';
      } else if (typeof before === 'string' && typeof after === 'string') {
        // For strings, longer is often better for SEO (meta descriptions, etc.)
        if (after.length > before.length && before.length < 160) {
          assessment = 'improved';
        } else if (after.length < before.length) {
          assessment = 'degraded';
        } else {
          assessment = 'neutral';
        }
      } else {
        assessment = 'neutral';
      }
    }

    return { changed, before, after, assessment };
  }

  /**
   * Analyze SEO impact of changes
   */
  private analyzeSEOImpact(
    before: ParsedContent,
    after: ParsedContent,
    changes: AnalyzeChangesResponse['changes']
  ): SEOImpactAnalysis {
    let impactScore = 0;
    const criticalChanges: string[] = [];
    const potentialIssues: string[] = [];
    const improvements: string[] = [];

    // Title changes
    if (changes.title.changed) {
      if (!after.title) {
        impactScore -= 30;
        criticalChanges.push('Title tag was removed');
      } else if (!before.title) {
        impactScore += 20;
        improvements.push('Title tag was added');
      } else if (after.title.length > before.title.length && after.title.length <= 60) {
        impactScore += 5;
        improvements.push('Title was improved');
      } else if (after.title.length > 60) {
        impactScore -= 5;
        potentialIssues.push('Title may be too long (>60 chars)');
      }
    }

    // Meta description changes
    if (changes.metaDescription.changed) {
      if (!after.metaDescription && before.metaDescription) {
        impactScore -= 15;
        criticalChanges.push('Meta description was removed');
      } else if (after.metaDescription && !before.metaDescription) {
        impactScore += 15;
        improvements.push('Meta description was added');
      }
    }

    // H1 changes
    if (changes.h1.changed) {
      const beforeH1 = Array.isArray(changes.h1.before) ? changes.h1.before as string[] : [];
      const afterH1 = Array.isArray(changes.h1.after) ? changes.h1.after as string[] : [];

      if (afterH1.length === 0 && beforeH1.length > 0) {
        impactScore -= 20;
        criticalChanges.push('H1 heading was removed');
      } else if (afterH1.length > 1) {
        impactScore -= 5;
        potentialIssues.push('Multiple H1 tags may cause SEO issues');
      }
    }

    // Content length changes
    if (changes.contentLength.percentChange < -30) {
      impactScore -= 20;
      criticalChanges.push(`Content reduced by ${Math.abs(changes.contentLength.percentChange)}%`);
    } else if (changes.contentLength.percentChange > 30) {
      impactScore += 10;
      improvements.push(`Content increased by ${changes.contentLength.percentChange}%`);
    }

    // Robots changes
    if (changes.robots.changed) {
      const afterRobots = String(changes.robots.after).toLowerCase();
      if (afterRobots.includes('noindex')) {
        impactScore -= 50;
        criticalChanges.push('Page set to noindex');
      }
    }

    // Canonical changes
    if (changes.canonical.changed && changes.canonical.after) {
      impactScore -= 10;
      potentialIssues.push('Canonical URL was changed');
    }

    // Determine overall impact
    let overallImpact: ImpactType;
    if (impactScore > 10) {
      overallImpact = 'positive';
    } else if (impactScore < -10) {
      overallImpact = 'negative';
    } else if (criticalChanges.length > 0 && improvements.length > 0) {
      overallImpact = 'mixed';
    } else {
      overallImpact = 'neutral';
    }

    return {
      overallImpact,
      impactScore: Math.max(-100, Math.min(100, impactScore)),
      criticalChanges,
      potentialIssues,
      improvements
    };
  }

  /**
   * Generate recommendations based on changes
   */
  private generateRecommendations(
    changes: AnalyzeChangesResponse['changes'],
    analysis: SEOImpactAnalysis
  ): string[] {
    const recommendations: string[] = [];

    if (analysis.criticalChanges.some(c => c.includes('Title tag was removed'))) {
      recommendations.push('Restore the title tag - this is critical for SEO');
    }

    if (analysis.criticalChanges.some(c => c.includes('Meta description was removed'))) {
      recommendations.push('Add a meta description to improve click-through rates');
    }

    if (analysis.criticalChanges.some(c => c.includes('H1 heading was removed'))) {
      recommendations.push('Add an H1 heading that includes your target keyword');
    }

    if (analysis.criticalChanges.some(c => c.includes('noindex'))) {
      recommendations.push('Remove noindex if this page should appear in search results');
    }

    if (analysis.criticalChanges.some(c => c.includes('Content reduced'))) {
      recommendations.push('Review content reduction - significant content loss may impact rankings');
    }

    if (recommendations.length === 0 && analysis.overallImpact === 'neutral') {
      recommendations.push('No significant SEO issues detected in the changes');
    }

    return recommendations;
  }

  /**
   * Generate correlation notes
   */
  private generateCorrelationNotes(
    changes: AnalyzeChangesResponse['changes'],
    analysis: SEOImpactAnalysis
  ): string {
    const notes: string[] = [];

    if (analysis.overallImpact === 'negative') {
      notes.push('The changes between these dates appear to have negative SEO implications.');
    }

    if (analysis.criticalChanges.length > 0) {
      notes.push(`${analysis.criticalChanges.length} critical change(s) detected that may affect rankings.`);
    }

    if (changes.contentLength.percentChange < -20) {
      notes.push('Significant content reduction often correlates with ranking drops.');
    }

    if (notes.length === 0) {
      notes.push('Changes appear minimal and unlikely to significantly impact rankings.');
    }

    return notes.join(' ');
  }

  /**
   * Generate a human-readable summary
   */
  private generateSummary(changes: CompareSnapshotsResponse['changes'], days: number): string {
    const parts: string[] = [];

    if (Object.keys(changes).length === 0) {
      return `No significant changes detected over ${days} days.`;
    }

    if (changes.title?.changed) {
      parts.push('title changed');
    }
    if (changes.metaDescription?.changed) {
      parts.push('meta description changed');
    }
    if (changes.headings?.h1Changed) {
      parts.push('H1 changed');
    }
    if (changes.content?.changed) {
      const delta = changes.content.wordCountDelta;
      if (delta > 0) {
        parts.push(`${delta} words added`);
      } else if (delta < 0) {
        parts.push(`${Math.abs(delta)} words removed`);
      } else {
        parts.push('content reorganized');
      }
    }
    if (changes.links?.changed) {
      parts.push('links modified');
    }

    return `Over ${days} days: ${parts.join(', ')}.`;
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }
}
