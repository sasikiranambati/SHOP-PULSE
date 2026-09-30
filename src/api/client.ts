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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

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
    const category = networkError instanceof TypeError ? 'NETWORK_OR_CORS_FAILURE' : 'NETWORK_ERROR';
    console.error(`[ShopPulse API] ${category} connecting to ${url}:`, networkError);
    throw new ApiError(
      'Unable to connect to ShopPulse backend server. Please verify the backend is running on http://127.0.0.1:8000.',
      0,
      networkError,
      category
    );
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
    let category = 'SERVER_ERROR';
    let errorMessage = '';

    if (response.status === 502 || response.status === 504) {
      category = 'PROXY_OR_BACKEND_UNAVAILABLE';
      errorMessage = 'Backend server is unavailable (502 Bad Gateway). Please make sure the FastAPI backend is running on port 8000.';
    } else if (response.status === 503) {
      category = 'SERVICE_UNAVAILABLE';
      errorMessage = 'Backend service is temporarily unavailable (503 Service Unavailable).';
    } else if (response.status === 401) {
      category = 'AUTHENTICATION_ERROR';
      errorMessage = 'Incorrect email or password, or session has expired.';
    } else if (response.status === 403) {
      category = 'AUTHORIZATION_FORBIDDEN';
      errorMessage = 'You do not have permission to perform this action.';
    } else if (response.status === 404) {
      category = 'NOT_FOUND';
      errorMessage = 'The requested resource was not found.';
    } else if (response.status === 422 || response.status === 400) {
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
          errorMessage = `Server returned error (${response.status} ${response.statusText || 'Error'}).`;
        }
      } else {
        errorMessage = data.trim();
      }
    }

    if (!errorMessage) {
      errorMessage = `Request failed with status ${response.status} (${response.statusText || 'Unknown Error'}).`;
    }

    console.error(`[ShopPulse API] [${category}] (${response.status}) ${endpoint}:`, {
      message: errorMessage,
      status: response.status,
      data,
    });

    // Auto clear expired token on 401 Unauthorized
    if (response.status === 401) {
      setAccessToken(null);
      window.dispatchEvent(new CustomEvent('shoppulse_auth_expired'));
    }

    throw new ApiError(errorMessage, response.status, data, category);
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
      body: body ? JSON.stringify(body) : undefined,
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
