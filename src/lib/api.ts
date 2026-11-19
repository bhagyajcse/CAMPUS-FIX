const TOKEN_KEY = 'campusfix_jwt_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function formatDeadlineCountdown(dueDateIso: string | null, status: string): {
  label: string;
  isOverdue: boolean;
  isUrgent: boolean;
} {
  if (!dueDateIso || status === 'Closed' || status === 'Resolved') {
    return { label: status === 'Closed' ? 'Completed' : status === 'Resolved' ? 'Awaiting confirmation' : '—', isOverdue: false, isUrgent: false };
  }
  const diffMs = new Date(dueDateIso).getTime() - Date.now();
  const absMin = Math.floor(Math.abs(diffMs) / 60000);
  const hours = Math.floor(absMin / 60);
  const mins = absMin % 60;

  if (diffMs < 0) {
    const overdueStr = hours > 0 ? `${hours}h ${mins}m overdue` : `${mins}m overdue`;
    return { label: overdueStr, isOverdue: true, isUrgent: true };
  }
  const remStr = hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
  return { label: remStr, isOverdue: false, isUrgent: diffMs <= 3600 * 1000 };
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
