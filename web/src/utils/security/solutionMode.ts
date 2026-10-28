// Copyright 2026 OpenObserve Inc.
//
// solutionMode.ts — which product the left nav shows, decided by the URL.
//
// The mode is remembered in localStorage so a reload lands where the analyst
// left off, but the URL is the source of truth: a shared /security/... link
// must open with the SIEM nav even for someone last in Observability, and a
// jump from a detection into /logs must bring the Observability nav back.
// Pages both products use (settings, IAM, destinations) keep whichever nav
// the user arrived with.

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

const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

/** The mode a route implies, or the current one for a shared route. */
export function solutionModeForPath(path: string, current: SolutionMode): SolutionMode {
  if (under(path, "/security")) return "security";
  if (SHARED_PREFIXES.some((prefix) => under(path, prefix))) return current;
  return "observability";
}
