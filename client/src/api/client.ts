function resolveApiBase() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8081/api';

  const configured = (window as any).__OHMX_API_BASE__;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/$/, '');
  }

  const { hostname, port } = window.location;
  const isLocalDev = hostname === '127.0.0.1' || hostname === 'localhost';

  if (isLocalDev && /^517\d$/.test(port)) {
    return 'http://127.0.0.1:8081/api';
  }

  return '/api';
}

const API = resolveApiBase();

function getStoredAdminToken() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('ek-admin-token') || '';
  } catch {
    return '';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers || {}) as Record<string, string>),
  };

  if (!headers.Authorization && !headers.authorization) {
    const token = getStoredAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'API error');
  }
  return res.json();
}

export { API };
