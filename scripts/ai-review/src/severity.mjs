export const SEVERITIES = ["p0", "p1", "p2", "p3"];
// Per-review limits; p0 and p1 are never capped because a blocker must always be reported.
export const SEVERITY_CAPS = { p2: 3, p3: 2 };
const LEGACY_SEVERITIES = new Map([
  ["critical", "p0"],
  ["warning", "p2"],
  ["suggestion", "p3"],
  ["low", "p3"],
]);

// An unrecognised value lands on p3 so a model typo can never raise a finding to a blocker.
export function normalizeSeverity(severity) {
  const value = String(severity ?? "").trim().toLowerCase();
  if (SEVERITIES.includes(value)) return value;
  return LEGACY_SEVERITIES.get(value) ?? "p3";
}

// Lower is more severe, so ascending sorts put p0 first.
export function severityRank(severity) {
  return SEVERITIES.indexOf(normalizeSeverity(severity));
}
