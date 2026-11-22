/**
 * The signed-in user's role in their shop (GET /shops/me/membership), loaded once per sign-in and shared.
 *
 * Only decides which actions the interface offers (verify pricing, approve requested prices). The server
 * authorizes every request on its own; when the role is unknown (loading, error, no shop) the interface
 * behaves as for a cashier and never offers manager-only actions.
 */
import { useEffect, useState } from 'react';
import { getAccessToken } from '../api/client';
import { shopsApi, type MyMembership } from '../api/shops';

type Status = 'loading' | 'ready' | 'error';

let cached: { token: string | null; membership: MyMembership } | null = null;
let pending: { token: string | null; promise: Promise<MyMembership> } | null = null;

export function loadMembership(): Promise<MyMembership> {
  const token = getAccessToken();
  if (cached && cached.token === token) return Promise.resolve(cached.membership);
  if (!pending || pending.token !== token) {
    const promise = shopsApi.getMyMembership().then((membership) => {
      cached = { token, membership };
      return membership;
    });
    pending = { token, promise };
    promise.finally(() => {
      if (pending?.promise === promise) pending = null;
    }).catch(() => undefined);
  }
  return pending.promise;
}

/** True only for roles that may verify pricing and approve requested prices. */
export function isApproverRole(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

export function useShopRole(): { membership: MyMembership | null; role: string | null; canApprove: boolean; status: Status } {
  const token = getAccessToken();
  const initial = cached && cached.token === token ? cached.membership : null;
  const [membership, setMembership] = useState<MyMembership | null>(initial);
  const [status, setStatus] = useState<Status>(initial ? 'ready' : 'loading');

  useEffect(() => {
    if (cached && cached.token === getAccessToken()) return;
    let active = true;
    loadMembership()
      .then((m) => {
        if (active) {
          setMembership(m);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const role = membership?.role ?? null;
  return { membership, role, canApprove: Boolean(membership?.can_approve_price_overrides), status };
}

/** Test helper: forget the cached membership. */
export function resetShopRoleCache(): void {
  cached = null;
  pending = null;
}
