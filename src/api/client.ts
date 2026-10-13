/**
 * @file client.ts
 * @description Centralized HTTP API client for ShopPulse frontend.
 * Belongs in `src/api/client.ts`.
 */

const rawUrl = (import.meta.env.VITE_API_URL || '').trim();
// In local development, if VITE_API_URL is empty or refers to localhost/127.0.0.1, use ''
// so requests are proxied by Vite (/api -> http://127.0.0.1:8000), avoiding CORS and IPv4/IPv6 localhost issues.
const API_BASE_URL = (import.meta.env.DEV && (rawUrl === '' || rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1')))
  ? ''
  : rawUrl.replace(/\/+$/, '');
const TOKEN_KEY = 'shoppulse_token';
const NETWORK_ERROR_MESSAGE =
  'Unable to connect to ShopPulse backend server. Please verify the backend is running on http://127.0.0.1:8000.';

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

export class ApiError extends Error {
  status: number;
  data: any;
  category?: string;

  constructor(message: string, status: number, data?: any, category?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.category = category;
  }
}

/**
 * Get current stored JWT access token.
 */
export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Set current JWT access token.
 */
export function setAccessToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore localStorage write error
  }
}

/**
 * Converts a failed HTTP response into an ApiError with a user-readable message.
 * Shared by fetch requests and XHR uploads so both report failures the same way.
 */
function toApiError(status: number, statusText: string, data: any, endpoint: string): ApiError {
  let category = 'SERVER_ERROR';
  let errorMessage = '';

  if (status === 502 || status === 504) {
    category = 'PROXY_OR_BACKEND_UNAVAILABLE';
    errorMessage = 'Backend server is unavailable (502 Bad Gateway). Please make sure the FastAPI backend is running on port 8000.';
  } else if (status === 503) {
    category = 'SERVICE_UNAVAILABLE';
    errorMessage = 'Backend service is temporarily unavailable (503 Service Unavailable).';
  } else if (status === 401) {
    category = 'AUTHENTICATION_ERROR';
    errorMessage = 'Incorrect email or password, or session has expired.';
  } else if (status === 403) {
    category = 'AUTHORIZATION_FORBIDDEN';
    errorMessage = 'You do not have permission to perform this action.';
  } else if (status === 404) {
    category = 'NOT_FOUND';
    errorMessage = 'The requested resource was not found.';
  } else if (status === 422 || status === 400) {
    category = 'VALIDATION_OR_CLIENT_ERROR';
  }

  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') {
      errorMessage = data.detail;
    } else if (Array.isArray(data.detail)) {
      errorMessage = data.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
    } else if (data.message) {
      errorMessage = data.message;
    }
  } else if (typeof data === 'string' && data.trim()) {
    if (data.trim().startsWith('<') || data.includes('<html')) {
      if (!errorMessage) {
        errorMessage = `Server returned error (${status} ${statusText || 'Error'}).`;
      }
    } else {
      errorMessage = data.trim();
    }
  }

  if (!errorMessage) {
    errorMessage = `Request failed with status ${status} (${statusText || 'Unknown Error'}).`;
  }

  console.error(`[ShopPulse API] [${category}] (${status}) ${endpoint}:`, {
    message: errorMessage,
    status: status,
    data,
  });

  // Auto clear expired token on 401 Unauthorized
  if (status === 401) {
    setAccessToken(null);
    window.dispatchEvent(new CustomEvent('shoppulse_auth_expired'));
  }

  return new ApiError(errorMessage, status, data, category);
}

/**
 * Main request method with centralized base URL, authorization headers, and error handling.
 */
async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers: customHeaders, ...restOptions } = options;

  // Build query string if params are provided
  let url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        searchParams.append(key, String(val));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  const token = getAccessToken();
  // File uploads: the browser must set multipart/form-data itself (it adds the boundary)
  const isFormData = typeof FormData !== 'undefined' && restOptions.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(customHeaders as Record<string, string>),
  };
  if (isFormData) {
    delete headers['Content-Type'];
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers,
    });
  } catch (networkError: any) {
    // A request cancelled by the caller (e.g. a newer search replaced it) is not a failure.
    if (networkError?.name === 'AbortError') {
      throw new ApiError('Request cancelled.', 0, networkError, 'ABORTED');
    }
    const category = networkError instanceof TypeError ? 'NETWORK_OR_CORS_FAILURE' : 'NETWORK_ERROR';
    console.error(`[ShopPulse API] ${category} connecting to ${url}:`, networkError);
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0, networkError, category);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  let data: any = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    throw toApiError(response.status, response.statusText, data, endpoint);
  }

  return data as T;
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'GET' }),
  
  post: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: typeof FormData !== 'undefined' && body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};

export interface UploadProgress {
  loaded: number;
  /** Null when the browser cannot tell the total size. */
  total: number | null;
  /** 0-100, or null when the total is unknown. */
  percent: number | null;
}

export interface UploadOptions {
  /** Called with the real number of bytes sent so far. */
  onUploadProgress?: (progress: UploadProgress) => void;
  /** Called once the whole file has been sent and the server is working on it. */
  onUploadComplete?: () => void;
  signal?: AbortSignal;
}

/**
 * POSTs a multipart form with XMLHttpRequest so upload progress can be reported from real
 * byte counts (fetch cannot report upload progress). Errors match apiClient's.
 */
export function uploadWithProgress<T>(endpoint: string, body: FormData, options: UploadOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    let uploadDone = false;
    const markUploadDone = () => {
      if (uploadDone) return;
      uploadDone = true;
      options.onUploadComplete?.();
    };

    xhr.upload.onprogress = (event: ProgressEvent) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : null;
      options.onUploadProgress?.({
        loaded: event.loaded,
        total,
        percent: total ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
      });
    };
    xhr.upload.onload = markUploadDone;

    xhr.onload = () => {
      markUploadDone();
      const contentType = xhr.getResponseHeader('content-type') || '';
      let data: any = xhr.responseText;
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        reject(toApiError(xhr.status, xhr.statusText, data, endpoint));
      }
    };
    xhr.onerror = () => {
      console.error(`[ShopPulse API] NETWORK_OR_CORS_FAILURE uploading to ${url}`);
      reject(new ApiError(NETWORK_ERROR_MESSAGE, 0, null, 'NETWORK_OR_CORS_FAILURE'));
    };
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0, null, 'ABORTED'));

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new ApiError('Upload cancelled.', 0, null, 'ABORTED'));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(body);
  });
}
