export type Round2Role = "elite" | "challenger";

export function normalizeRound2Role(value: unknown): Round2Role | null {
  if (typeof value !== "string") return null;
  const role = value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/^r2\/?/, "");
  if (role === "elite" || role === "challenger") return role;
  return null;
}

export function persistRound2Role(role: Round2Role) {
  try {
    sessionStorage.setItem("r2_user_role", role);
  } catch {
    // ignore storage failures
  }
}

export function readStoredRound2Role(): Round2Role | null {
  try {
    return normalizeRound2Role(sessionStorage.getItem("r2_user_role"));
  } catch {
    return null;
  }
}

export function round2RolePath(role: Round2Role) {
  return `/r2/${role}`;
}

export function hasLocalRound2Session() {
  try {
    return Boolean(
      sessionStorage.getItem("r2_session_type") &&
      sessionStorage.getItem("r2_context_id"),
    );
  } catch {
    return false;
  }
}

export function identitiesMatch(
  left?: string | null,
  right?: string | null,
): boolean {
  if (!left || !right) return false;
  return left === right || left.toLowerCase() === right.toLowerCase();
}
