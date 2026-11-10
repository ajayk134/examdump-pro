export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly expose = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource'): AppError =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, 'CONFLICT', message, details);

export const tooManyRequests = (message = 'Too many requests'): AppError =>
  new AppError(429, 'RATE_LIMITED', message);

export const notImplemented = (message = 'Not implemented'): AppError =>
  new AppError(501, 'NOT_IMPLEMENTED', message);

export const serviceUnavailable = (message = 'Service temporarily unavailable'): AppError =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

export const quotaExceeded = (message: string, details?: unknown): AppError =>
  new AppError(403, 'QUOTA_EXCEEDED', message, details);