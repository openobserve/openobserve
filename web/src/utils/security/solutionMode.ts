// Copyright 2026 OpenObserve Inc.

// The URL, not the remembered mode, is the source of truth, so a shared /security link opens the SIEM nav.

export type SolutionMode = "observability" | "security";

/** Routes that belong to neither product, so they leave the mode alone. */
const SHARED_PREFIXES = [
  "/settings",
  "/iam",
  "/profile",
  "/about",
  "/organizations",
  "/alert-destinations",
  "/alert-templates",
  "/alert-sources",
  "/short",
  "/member_subscription",
  "/billings",
  "/login",
  "/logout",
  "/cb",
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The mode a route implies, or the current one for a shared route; observability for a user who may not open Security. */
export function solutionModeForPath(
  path: string,
  current: SolutionMode,
  canOpenSecurity = true,
): SolutionMode {
  if (!canOpenSecurity) return "observability";
  if (under(path, "/security")) return "security";
  if (SHARED_PREFIXES.some((prefix) => under(path, prefix))) return current;
  return "observability";
}
