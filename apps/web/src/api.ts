import type { Paged, Problem } from './types';

const BASE = (import.meta.env.VITE_API_BASE || '/api/v1').replace(/\/$/, '');
let csrfToken: string | undefined;

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  fieldErrors?: Array<{path:string;code:string;message:string}>;
  correlationId?: string;
  currentVersion?: number;
  conflicts?: Problem['conflicts'];
  constructor(problem: Problem) {
    super(problem.title || problem.detail || 'Запрос не выполнен');
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.fieldErrors = Array.isArray(problem.field_errors) ? problem.field_errors : problem.field_errors ? Object.entries(problem.field_errors).map(([path,message])=>({path,code:'FIELD_ERROR',message})) : undefined;
    this.correlationId = problem.correlation_id;
    this.currentVersion = problem.current_version;
    this.conflicts = problem.conflicts;
  }
}

export function setCsrfToken(token?: string) { csrfToken = token; }

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  version?: number;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const unsafe = method !== 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (unsafe && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (unsafe) headers['Idempotency-Key'] = options.idempotencyKey || crypto.randomUUID();
  if (options.version !== undefined) headers['If-Match'] = `"${options.version}"`;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', title: 'Нет соединения с сервером', detail: 'Проверьте соединение и повторите запрос.' });
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') || '';
  let data: unknown = undefined;
  if (contentType.includes('json')) {
    try { data = await response.json(); } catch { /* handled below */ }
  }
  if (!response.ok) {
    const candidate = typeof data === 'object' && data !== null ? data as Partial<Problem> : {};
    throw new ApiError({
      status: response.status,
      code: candidate.code || (response.status === 403 ? 'ACCESS_DENIED' : 'REQUEST_FAILED'),
      title: candidate.title || `Ошибка ${response.status}`,
      detail: candidate.detail,
      correlation_id: candidate.correlation_id,
      field_errors: candidate.field_errors,
      current_version: candidate.current_version,
      conflicts: candidate.conflicts
    });
  }
  if (data === undefined) throw new ApiError({ status: 502, code: 'INVALID_RESPONSE', title: 'Сервер вернул неожиданный ответ' });
  return data as T;
}

export function orgPath(orgId: string, resource: string) {
  return `/organizations/${encodeURIComponent(orgId)}/${resource.replace(/^\//, '')}`;
}

export function itemsOf<T>(value: Paged<T> | T[] | { data?: T[] }): T[] {
  if (Array.isArray(value)) return value;
  if ('items' in value && Array.isArray(value.items)) return value.items;
  if ('data' in value && Array.isArray(value.data)) return value.data;
  return [];
}

export function query(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') search.set(key, String(value)); });
  const value = search.toString();
  return value ? `?${value}` : '';
}
