const RAW_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? '').trim().replace(/\/+$/, '');
const RAW_SOCKET_URL = (import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_WS_URL ?? '')
  .trim()
  .replace(/\/+$/, '');

function isStaticGitHubPagesHost(): boolean {
  if (typeof window === 'undefined') return false;
  return /\.github\.io$/i.test(window.location.hostname);
}

export function isMultiplayerConfigured(): boolean {
  if (RAW_BACKEND_URL || RAW_SOCKET_URL) return true;
  return !isStaticGitHubPagesHost();
}

export function getBackendHttpBase(): string {
  if (RAW_BACKEND_URL) return RAW_BACKEND_URL;
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
  if (RAW_SOCKET_URL) return RAW_SOCKET_URL;
  if (RAW_BACKEND_URL) return RAW_BACKEND_URL;
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
