/**
 * Normalize various date formats to Wayback timestamp format (YYYYMMDDhhmmss)
 */
export function normalizeTimestamp(input: string): string {
  // Already in timestamp format (14 digits)
  if (/^\d{14}$/.test(input)) {
    return input;
  }

  // Partial timestamp (less than 14 digits)
  if (/^\d{1,13}$/.test(input)) {
    return input.padEnd(14, '0');
  }

  // YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input.replace(/-/g, '') + '000000';
  }

  // YYYY-MM-DD HH:MM:SS format
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    return input.replace(/[-: ]/g, '');
  }

  // Try to parse as date
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return formatDateToTimestamp(date);
  }

  // Return as-is if can't parse
  return input;
}

/**
 * Format a Date object to Wayback timestamp format
 */
export function formatDateToTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Format a Wayback timestamp to human-readable date (YYYY-MM-DD)
 */
export function formatTimestamp(timestamp: string): string {
  if (timestamp.length < 8) {
    return timestamp;
  }

  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);

  return `${year}-${month}-${day}`;
}

/**
 * Format a Wayback timestamp to full datetime (YYYY-MM-DD HH:MM:SS)
 */
export function formatTimestampFull(timestamp: string): string {
  if (timestamp.length < 14) {
    return formatTimestamp(timestamp);
  }

  const date = formatTimestamp(timestamp);
  const hours = timestamp.slice(8, 10);
  const minutes = timestamp.slice(10, 12);
  const seconds = timestamp.slice(12, 14);

  return `${date} ${hours}:${minutes}:${seconds}`;
}

/**
 * Parse a Wayback timestamp to Date object
 */
export function parseTimestamp(timestamp: string): Date {
  const year = parseInt(timestamp.slice(0, 4), 10);
  const month = parseInt(timestamp.slice(4, 6), 10) - 1;
  const day = parseInt(timestamp.slice(6, 8), 10);
  const hours = timestamp.length >= 10 ? parseInt(timestamp.slice(8, 10), 10) : 0;
  const minutes = timestamp.length >= 12 ? parseInt(timestamp.slice(10, 12), 10) : 0;
  const seconds = timestamp.length >= 14 ? parseInt(timestamp.slice(12, 14), 10) : 0;

  return new Date(year, month, day, hours, minutes, seconds);
}

/**
 * Calculate days between two timestamps
 */
export function daysBetween(timestamp1: string, timestamp2: string): number {
  const date1 = parseTimestamp(timestamp1);
  const date2 = parseTimestamp(timestamp2);

  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Get default date range (last N days)
 */
export function getDateRange(days: number): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate)
  };
}

/**
 * Format Date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Format a duration in days to human-readable string
 */
export function formatDuration(days: number): string {
  if (days < 1) {
    return 'less than a day';
  }
  if (days === 1) {
    return '1 day';
  }
  if (days < 7) {
    return `${days} days`;
  }
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? '1 month' : `${months} months`;
  }

  const years = Math.round(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}
