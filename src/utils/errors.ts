import { WaybackApiError } from '../types/index.js';

export function formatError(error: unknown): { error: { code: string; message: string; details?: Record<string, unknown> } } {
  if (error instanceof WaybackApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details })
      }
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: 'UNKNOWN_ERROR',
        message: error.message
      }
    };
  }

  return {
    error: {
      code: 'UNKNOWN_ERROR',
      message: String(error)
    }
  };
}

export function handleToolError(error: unknown): string {
  const formatted = formatError(error);
  return JSON.stringify(formatted, null, 2);
}
