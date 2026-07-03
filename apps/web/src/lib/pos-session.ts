const POS_SESSION_PREFIX = "nexus-pos-session-";

export type PosStaffSession = {
  token: string;
  staffId: string;
  displayName: string;
  role: string;
  organizationId: string;
  registerId: string;
};

export function posSessionKey(registerId: string) {
  return `${POS_SESSION_PREFIX}${registerId}`;
}

export function getStoredPosSession(registerId: string): PosStaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(posSessionKey(registerId));
    if (!raw) return null;
    return JSON.parse(raw) as PosStaffSession;
  } catch {
    return null;
  }
}

export function storePosSession(registerId: string, session: PosStaffSession) {
  localStorage.setItem(posSessionKey(registerId), JSON.stringify(session));
}

export function clearPosSession(registerId: string) {
  localStorage.removeItem(posSessionKey(registerId));
}
