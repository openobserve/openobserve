import { passLabel } from "./passes.mjs";

// The transport cuts a user prompt here, so anything past it never reaches the model.
export const MAX_USER_PROMPT_CHARS = 150_000;

// Tried in order once the full prompt is too big; every finding keeps its severity, place, summary and fix at each step.
const DESCRIPTION_LIMITS = [Infinity, 1000, 500, 200, 80, 0];

function shortened(text, limit) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return limit === 0 ? "[omitted to fit]" : `${value.slice(0, limit)}… [truncated]`;
}

function findingXml(f, descriptionLimit) {
  return `  <finding>
    <category>${f.category}</category>
    <severity>${f.severity}</severity>
    <file>${f.file}</file>
    <line>${f.line}</line>
    <summary>${f.summary}</summary>
    <description>${shortened(f.description, descriptionLimit)}</description>
    <suggestion>${f.suggestion}</suggestion>
  </finding>`;
}

export function coordinatorFindingsXml(passResults, passes, { descriptionLimit = Infinity, dedupe = false } = {}) {
  const seen = new Set();
  return passResults
    .map(r => {
      const findings = (r.findings || []).filter(f => {
        if (!dedupe) return true;
        const key = JSON.stringify([r.agentKey, f.severity, f.file, f.line, f.summary, f.description, f.suggestion]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (findings.length === 0) return "";
      const xml = findings.map(f => findingXml(f, descriptionLimit)).join("\n");
      return `<reviewer name="${passLabel(r.agentName, r.pass, passes)}">\n${xml}\n</reviewer>`;
    })
    .filter(Boolean)
    .join("\n");
}

// Never hands back a prompt the transport would cut: a cut prompt silently loses the later passes' findings.
export function fitCoordinatorPrompt(passResults, passes, build, limit = MAX_USER_PROMPT_CHARS) {
  const full = build(coordinatorFindingsXml(passResults, passes));
  if (full.length <= limit) return { prompt: full, mode: "full", chars: full.length };
  for (const descriptionLimit of DESCRIPTION_LIMITS) {
    const prompt = build(coordinatorFindingsXml(passResults, passes, { descriptionLimit, dedupe: true }));
    if (prompt.length <= limit) return { prompt, mode: "compacted", chars: prompt.length, fullChars: full.length };
  }
  return { prompt: null, mode: "too_large", chars: full.length, fullChars: full.length };
}
