import * as cheerio from 'cheerio';
import type { ParsedContent, ParsedLink } from '../types/index.js';

/**
 * Parse HTML content and extract SEO-relevant information
 */
export function parseHtml(html: string, baseUrl: string): ParsedContent {
  const $ = cheerio.load(html);

  // Extract metadata
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
  const metaKeywords = $('meta[name="keywords"]').attr('content')?.trim() || '';
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || '';
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
  const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || '';
  const robots = $('meta[name="robots"]').attr('content')?.trim() || '';

  // Extract headings
  const h1: string[] = [];
  $('h1').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1.push(text);
  });

  const h2: string[] = [];
  $('h2').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h2.push(text);
  });

  // Extract text content (remove scripts, styles, etc.)
  const textContent = extractTextContent($);

  // Extract links
  const links = extractLinks($, baseUrl);

  // Extract structured data
  const structuredData = extractStructuredData($);

  // Count words
  const wordCount = countWords(textContent);

  return {
    title,
    metaDescription,
    metaKeywords,
    canonicalUrl,
    ogTitle,
    ogDescription,
    h1,
    h2,
    robots,
    textContent,
    links,
    structuredData,
    wordCount
  };
}

/**
 * Extract text content from HTML, removing scripts, styles, and other non-content elements
 */
function extractTextContent($: cheerio.CheerioAPI): string {
  // Clone the body to avoid modifying the original
  const $body = $('body').clone();

  // Remove non-content elements
  $body.find('script, style, nav, header, footer, aside, noscript, iframe, svg').remove();

  // Get text and clean up whitespace
  const text = $body.text()
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Extract all links from the page
 */
function extractLinks($: cheerio.CheerioAPI, baseUrl: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let baseDomain: string;

  try {
    baseDomain = new URL(baseUrl).hostname;
  } catch {
    baseDomain = '';
  }

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      // Handle relative URLs
      const absoluteUrl = new URL(href, baseUrl);

      // Skip non-http URLs
      if (!absoluteUrl.protocol.startsWith('http')) return;

      // Check if external
      const isExternal = baseDomain ? absoluteUrl.hostname !== baseDomain : false;

      links.push({
        href: absoluteUrl.href,
        isExternal
      });
    } catch {
      // Skip invalid URLs
    }
  });

  return links;
}

/**
 * Extract structured data (JSON-LD) from the page
 */
function extractStructuredData($: cheerio.CheerioAPI): object[] {
  const structuredData: object[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (!content) return;

    try {
      const data = JSON.parse(content);
      structuredData.push(data);
    } catch {
      // Skip invalid JSON
    }
  });

  return structuredData;
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter(word => word.length > 0)
    .length;
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Compare two arrays and check if they are equal
 */
export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

/**
 * Get the type names of structured data items
 */
export function getStructuredDataTypes(data: object[]): string[] {
  const types: string[] = [];

  for (const item of data) {
    if (typeof item === 'object' && item !== null) {
      const type = (item as Record<string, unknown>)['@type'];
      if (typeof type === 'string') {
        types.push(type);
      } else if (Array.isArray(type)) {
        types.push(...type.filter(t => typeof t === 'string'));
      }
    }
  }

  return types;
}
