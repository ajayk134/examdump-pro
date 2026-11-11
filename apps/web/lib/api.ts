export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers } = options;
  const response = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: 'include',
    signal,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'REQUEST_FAILED',
      err?.message ?? `Request failed with status ${response.status}`,
      err?.details,
    );
  }

  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function apiBase(): string {
  return `${BASE}/api`;
}
/* ------------------------------------------------------------------ */
/* Server-sent event streaming                                         */
/* ------------------------------------------------------------------ */

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone?: (meta: { model?: string; degraded?: boolean }) => void;
  onError?: (message: string) => void;
}

/**
 * POST a JSON body and consume the `text/event-stream` response.
 *
 * `fetch` is used directly (not `EventSource`) because the endpoint requires a
 * POST body and cookie auth. Resolves when the stream ends; rejects only on
 * transport failure, so callers can render partial answers.
 */
export async function streamPost(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep the default message */
    }
    handlers.onError?.(message);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    handlers.onError?.('The response stream could not be read.');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const handleFrame = (frame: string) => {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const chunk = JSON.parse(payload) as {
          type: 'delta' | 'done' | 'error';
          text?: string;
          model?: string;
          degraded?: boolean;
          message?: string;
        };
        if (chunk.type === 'delta' && chunk.text) handlers.onDelta(chunk.text);
        else if (chunk.type === 'done') handlers.onDone?.({ model: chunk.model, degraded: chunk.degraded });
        else if (chunk.type === 'error') handlers.onError?.(chunk.message ?? 'The AI tutor is unavailable.');
      } catch {
        /* ignore malformed frames */
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    frames.forEach(handleFrame);
  }
  if (buffer.trim()) handleFrame(buffer);
}
