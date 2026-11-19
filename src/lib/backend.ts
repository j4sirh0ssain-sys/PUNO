const RAW_BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? '';
const RAW_SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_WS_URL ?? '';

function normalizeServerOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let candidate = trimmed;
  if (/^wss:\/\//i.test(candidate)) {
    candidate = `https://${candidate.slice(6)}`;
  } else if (/^ws:\/\//i.test(candidate)) {
    candidate = `http://${candidate.slice(5)}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(candidate);
    candidate = `${isLocal ? 'http' : 'https'}://${candidate}`;
  }

  try {
    return new URL(candidate).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

const BACKEND_ORIGIN = normalizeServerOrigin(RAW_BACKEND_URL);
const SOCKET_ORIGIN = normalizeServerOrigin(RAW_SOCKET_URL);

function isStaticGitHubPagesHost(): boolean {
  if (typeof window === 'undefined') return false;
  return /\.github\.io$/i.test(window.location.hostname);
}

export function isMultiplayerConfigured(): boolean {
  if (BACKEND_ORIGIN || SOCKET_ORIGIN) return true;
  return !isStaticGitHubPagesHost();
}

export function getBackendHttpBase(): string {
  if (BACKEND_ORIGIN) return BACKEND_ORIGIN;
  if (SOCKET_ORIGIN) return SOCKET_ORIGIN;
  if (isStaticGitHubPagesHost()) {
    throw new Error(
      'Multiplayer server is not configured yet. Deploy server/ and set VITE_BACKEND_URL.'
    );
  }
  return '';
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendHttpBase();
  return `${base}${normalizedPath}`;
}

export function getSocketServerUrl(): string | undefined {
  if (SOCKET_ORIGIN) return SOCKET_ORIGIN;
  if (BACKEND_ORIGIN) return BACKEND_ORIGIN;
  if (isStaticGitHubPagesHost()) {
    throw new Error(
      'Multiplayer Socket.IO URL is not configured yet. Deploy server/ and set VITE_BACKEND_URL.'
    );
  }
  return undefined; // Connects to same origin during local full-stack dev
}

export async function wakeBackendServer(): Promise<void> {
  try {
    const url = buildApiUrl('/health');
    await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
  } catch {
    // Ignore wakeup error; Socket.IO reconnection handles retries
  }
}
