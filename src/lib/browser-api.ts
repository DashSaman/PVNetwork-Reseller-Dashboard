/** Session rejection is distinct from an upstream service failure. */
export const SESSION_RECHECK_EVENT = "pvnetwork:session-recheck";

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Login failures belong to the login form. A dashboard rejection must
      // re-read the actual cookie session, including a change of account/role.
      if (res.status === 401 && /^\/api\/(admin|reseller)(\/|\?)/.test(url) && typeof window !== "undefined") {
        window.dispatchEvent(new Event(SESSION_RECHECK_EVENT));
      }
      return { ok: false, status: res.status, error: (json as { error?: string }).error || "خطای نامشخص" };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (e) {
    return { ok: false, error: `خطای شبکه: ${(e as Error).message}` };
  }
}
