// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Builds a RichCardContent from a data-source-ui.md whose YAML frontmatter holds
// the full card definition (see parseFrontmatter.ts). This is a direct 1:1 map —
// no markdown prose parsing — so the content repo is the single source of truth
// and the web stays a thin renderer. A card opts in simply by having a `detect:`
// block in its frontmatter; without it, this returns null (→ legacy markdown card).
//
// Code blocks carry {url}/{org}/{token} placeholders, substituted per-org here.
// The stream the installer writes to and `detect.stream` are BOTH authored in this
// md, so they're kept in lockstep by the content (no frontend capability gate).

import type { CardSubstitutions } from "../renderMarkdown";
import type { RichCardContent, RichCardStep, StepCompleteOn } from "./types";
import { parseFrontmatter } from "./parseFrontmatter";
import { applySubs, applySubsMasked } from "./subs";

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const trimTrailing = (s: string) => s.replace(/\n+$/, "");

function buildStep(raw: any, slug: string, i: number, subs: CardSubstitutions): RichCardStep {
  const code = raw?.code
    ? (() => {
        const text = trimTrailing(String(raw.code.text ?? ""));
        const hasToken = text.includes("{token}");
        return {
          lang: str(raw.code.lang) ?? "",
          raw: applySubs(text, subs),
          masked: hasToken ? applySubsMasked(text, subs) : undefined,
          filename: str(raw.code.filename),
          downloadEnv: !!raw.code.download_env,
        };
      })()
    : undefined;

  const completeOn: StepCompleteOn = raw?.complete_on === "detect" ? "detect" : "copy";

  return {
    id: str(raw?.id) ?? `${slug}-${i + 1}`,
    title: str(raw?.title) ?? `Step ${i + 1}`,
    description: str(raw?.description) ?? "",
    chip: raw?.chip ? { kind: raw.chip.kind, label: String(raw.chip.label) } : undefined,
    code,
    note: str(raw?.note),
    pills: Array.isArray(raw?.pills) ? raw.pills.map(String) : undefined,
    completeOn,
    required: !!raw?.required,
    detectionAnchor: !!raw?.detection_anchor,
  };
}

/** Build rich card content from md frontmatter, or null if it isn't a rich card. */
export function buildFromMarkdown(
  slug: string,
  md: string,
  subs: CardSubstitutions,
): RichCardContent | null {
  const { data } = parseFrontmatter(md);
  // A `detect:` block is what marks an integration as rich-card-enabled.
  if (!data?.detect || !data?.card) return null;

  const card = data.card ?? {};
  const detect = data.detect ?? {};
  const extras = data.extras ?? {};
  const steps: any[] = Array.isArray(data.steps) ? data.steps : [];

  return {
    provider: {
      name: str(card.name) ?? slug,
      tagline: str(card.tagline) ?? "",
      // Logo URL from the md frontmatter (else ""). A manifest `logo` overrides
      // at render; with neither, the card shows a lettered monogram.
      logo: str(card.logo) ?? "",
      tone: str(card.tone) ?? "#d97757",
      runtime: str(card.runtime),
      setupTime: str(card.setup_time),
    },
    steps: steps.map((s, i) => buildStep(s, slug, i, subs)),
    detect: {
      streamType: detect.stream_type === "logs" ? "logs" : "traces",
      streamName: str(detect.stream),
      filter: str(detect.filter) ?? "",
      modelLabel: str(detect.model_label),
      pollMs: typeof detect.poll_ms === "number" ? detect.poll_ms : undefined,
      timeoutMs: typeof detect.timeout_ms === "number" ? detect.timeout_ms : undefined,
    },
    extras: {
      installs: Array.isArray(extras.installs) ? extras.installs.map(String) : undefined,
      envVars: Array.isArray(extras.env_vars) ? extras.env_vars.map(String) : undefined,
      fixSnippet: str(data.fix_snippet),
      troubleshooting: Array.isArray(data.troubleshooting)
        ? data.troubleshooting.map((t: any) => ({ q: String(t.q), a: String(t.a) }))
        : undefined,
    },
    docUrl: str(data.doc_url),
    slackUrl: str(data.slack_url),
  };
}
