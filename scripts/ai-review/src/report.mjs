function shortName(agentName) {
  return String(agentName || "unknown").replace(/\s+Reviewer$/i, "");
}

function failureReason(result) {
  if (result.timedOut || /timed out|TimeoutError/i.test(result.error || "")) return "timed out";
  return "failed";
}

// Written by code, never by the coordinator: a reader must always learn that an area went unreviewed.
export function failedReviewersNote(failed, ranCount) {
  if (!failed.length) return "";
  const detail = failed.map(r => `${shortName(r.agentName)}: ${failureReason(r)}`).join(", ");
  const tail = failed.length === 1 ? "its area was not reviewed" : "their areas were not reviewed";
  return `> ⚠️ ${failed.length} of ${ranCount} reviewers did not finish (${detail}); ${tail}.`;
}

// Puts the note after the decision callout (or the heading, if the callout is missing) as its own blockquote.
export function insertAfterCallout(body, note) {
  if (!note) return body;
  const lines = body.split("\n");
  const heading = lines.findIndex(l => /^#{1,3}\s/.test(l));
  let at = heading + 1;
  const callout = lines.findIndex((l, i) => i > heading && /^>\s*\[!(?:TIP|NOTE|WARNING|CAUTION|IMPORTANT)\]/i.test(l));
  if (callout !== -1) {
    at = callout;
    while (at < lines.length && lines[at].startsWith(">")) at += 1;
  }
  lines.splice(at, 0, "", note, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Applies `clean` to every string in a JSON-shaped value; used to scrub the findings artifact field by field.
export function mapStrings(value, clean) {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(v => mapStrings(v, clean));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, clean)]));
  }
  return value;
}
