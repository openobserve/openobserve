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

import type {
  CardSubstitutions,
  RichCardContent,
  RichCardStep,
  StepCompleteOn,
} from "@/components/ingestion/setupCard/types";
import { parseFrontmatter } from "./parseFrontmatter";
import { applySubs, applySubsMasked } from "@/components/ingestion/setupCard/subs";
import { resolveAICardLogo } from "../index";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
// Card copy is authored in the content repo's markdown, not in the locale files,
// so it is deliberately untranslated here (`raw`) rather than looked up via `t`.
const rawStr = (v: unknown): I18nText | undefined => (typeof v === "string" ? raw(v) : undefined);

/** Maps md `stream_type` to the detect streamType union (else traces). */
const STREAM_TYPES: Record<string, "logs" | "metrics" | "traces"> = {
  logs: "logs",
  metrics: "metrics",
  traces: "traces",
};
const trimTrailing = (s: string) => s.replace(/\n+$/, "");

// Param is named `src`, not `raw`, so it doesn't shadow the `raw()` i18n helper.
function buildStep(src: any, slug: string, i: number, subs: CardSubstitutions): RichCardStep {
  const code = src?.code
    ? (() => {
        const text = trimTrailing(String(src.code.text ?? ""));
        const hasToken = text.includes("{token}");
        return {
          lang: str(src.code.lang) ?? "",
          raw: applySubs(text, subs),
          masked: hasToken ? applySubsMasked(text, subs) : undefined,
          filename: str(src.code.filename),
          downloadEnv: !!src.code.download_env,
        };
      })()
    : undefined;

  const completeOn: StepCompleteOn = src?.complete_on === "detect" ? "detect" : "copy";

  return {
    id: str(src?.id) ?? `${slug}-${i + 1}`,
    title: raw(str(src?.title) ?? `Step ${i + 1}`),
    description: raw(str(src?.description) ?? ""),
    chip: src?.chip ? { kind: src.chip.kind, label: raw(String(src.chip.label)) } : undefined,
    code,
    note: rawStr(src?.note),
    pills: Array.isArray(src?.pills) ? src.pills.map(String) : undefined,
    completeOn,
    required: !!src?.required,
    detectionAnchor: !!src?.detection_anchor,
  };
}

/** Build rich card content from md frontmatter, or null if it isn't a rich card. */
export function buildFromMarkdown(
  slug: string,
  md: string,
  subs: CardSubstitutions,
  t: TranslateFn,
): RichCardContent | null {
  const { data } = parseFrontmatter(md);
  // A `detect:` block is what marks an integration as rich-card-enabled.
  if (!data?.detect || !data?.card) return null;

  const card = data.card ?? {};
  const detect = data.detect ?? {};
  const extras = data.extras ?? {};
  const steps: any[] = Array.isArray(data.steps) ? data.steps : [];
  // `{stream}` in code is intentionally NOT substituted here — it resolves
  // reactively in the card from the stream-name input (see AIRichSetupCard.vue).
  const si = data.stream_input;

  return {
    provider: {
      name: str(card.name) ?? slug,
      tagline: raw(str(card.tagline) ?? ""),
      // Logo from the md frontmatter, resolved to a bundled asset URL (or an
      // absolute URL as-is). A manifest `logo` overrides at render; with neither,
      // the card shows a lettered monogram. `logo_dark` is used only in dark mode.
      logo: resolveAICardLogo(slug, str(card.logo)),
      logoDark: resolveAICardLogo(slug, str(card.logo_dark)) || undefined,
      tone: str(card.tone) ?? "#d97757",
      runtime: rawStr(card.runtime),
      setupTime: rawStr(card.setup_time),
    },
    steps: steps.map((s, i) => buildStep(s, slug, i, subs)),
    streamInput: si
      ? {
          label: rawStr(si.label) ?? t("ingestion.setupCard.streamNameLabel"),
          default: str(si.default) ?? "default",
          placeholder: rawStr(si.placeholder),
          help: rawStr(si.help),
        }
      : undefined,
    detect: {
      // Unknown/absent stream types fall back to traces (the AI default).
      streamType: STREAM_TYPES[detect.stream_type] ?? "traces",
      // Only the two valid match modes pass through (else exact via undefined).
      match:
        detect.match === "keyword" ? "keyword" : detect.match === "exact" ? "exact" : undefined,
      streamName: str(detect.stream),
      filter: str(detect.filter) ?? "",
      modelLabel: str(detect.model_label),
    },
    extras: {
      installs: Array.isArray(extras.installs) ? extras.installs.map(String) : undefined,
      envVars: Array.isArray(extras.env_vars) ? extras.env_vars.map(String) : undefined,
      fixSnippet: str(data.fix_snippet),
      fixTitle: rawStr(data.fix_title),
      fixBody: rawStr(data.fix_body),
      fixLang: str(data.fix_lang),
      troubleshooting: Array.isArray(data.troubleshooting)
        ? data.troubleshooting.map((t: any) => ({ q: raw(String(t.q)), a: raw(String(t.a)) }))
        : undefined,
    },
    docUrl: str(data.doc_url),
    slackUrl: str(data.slack_url),
  };
}
