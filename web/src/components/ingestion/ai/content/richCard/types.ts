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

// Generic content schema for the rich, stepped AI-integration setup card
// (AIRichSetupCard.vue). One typed object per provider describes everything the
// card renders — hero, ordered steps, the live-detection config, and the
// supplementary accordions — so the component stays presentational and any
// integration can opt in by authoring a RichCardContent (see ./registry.ts).

import type { CardSubstitutions } from "../renderMarkdown";

/** Context of a step → drives both the title chip and the code-block chrome. */
export type StepChipKind = "terminal" | "editor" | "run" | "traces";

/** How a step is marked complete: the user copies its code, or a span lands. */
export type StepCompleteOn = "copy" | "detect";

export interface RichCardChip {
  kind: StepChipKind;
  label: string;
}

export interface RichCardCode {
  /** Fence language for highlighting, e.g. "bash" / "python". */
  lang: string;
  /** Raw code (already token-substituted) — displayed when revealed, and copied. */
  raw: string;
  /** Optional masked variant (token hidden) shown by default; copy uses `raw`. */
  masked?: string;
  /** Filename shown in the "editor" chrome tab. */
  filename?: string;
  /** Show a ".env" download button in the block toolbar. */
  downloadEnv?: boolean;
}

export interface RichCardStep {
  /** Stable id (also used as the scroll target for the next-step auto-advance). */
  id: string;
  title: string;
  /** Inline markdown: supports **bold** and `code` only (rendered safely). */
  description: string;
  chip?: RichCardChip;
  code?: RichCardCode;
  /** Small muted note rendered under the code (e.g. the load_dotenv caveat). */
  note?: string;
  /** Monospace pills rendered after the description (e.g. captured attributes). */
  pills?: string[];
  completeOn: StepCompleteOn;
  required?: boolean;
  /** The step that hosts the live status bar + "most likely fix" box. */
  detectionAnchor?: boolean;
}

export interface RichCardDetect {
  streamType: "traces" | "logs";
  /**
   * Stream to count over — MUST be the same stream the install command writes
   * to. Authored alongside the command in the md frontmatter (`detect.stream`),
   * so the two stay in lockstep. Omitted → falls back to "default".
   */
  streamName?: string;
  /** SQL WHERE fragment identifying the provider's spans, e.g.
   *  "gen_ai_system = 'Anthropic'". TODO: confirm exact attribute on ingest. */
  filter: string;
  /** Shown in the connected status line (e.g. the model name). */
  modelLabel?: string;
  /** Poll cadence (ms). Default 3000. */
  pollMs?: number;
  /** Give up after this long → "stalled". Default 60000. */
  timeoutMs?: number;
}

export interface RichCardExtras {
  /** Packages the installer adds (pills). */
  installs?: string[];
  /** Env vars the installer writes (pills). */
  envVars?: string[];
  /** Correct-ordering fix shown when detection stalls. */
  fixSnippet?: string;
  troubleshooting?: { q: string; a: string }[];
}

export interface RichCardProvider {
  name: string;
  tagline: string;
  /** Imported logo asset URL (rendered on a neutral tile). */
  logo: string;
  /** Brand accent (clay etc.) — reserved for future per-provider theming. */
  tone: string;
  runtime?: string;
  setupTime?: string;
}

/**
 * Optional user-set stream name. When present, the card renders a text field;
 * its value flows reactively into the install command (the `{stream}`
 * placeholder) AND the live detection, keeping the stream the installer writes
 * to and the stream the card listens on in lockstep.
 */
export interface RichCardStreamInput {
  /** Field label, e.g. "Traces Stream Name". */
  label: string;
  /** Stream used when the field is left blank (e.g. "default"). */
  default: string;
  /** Placeholder (falls back to `default`). */
  placeholder?: string;
  /** Helper text under the field. */
  help?: string;
}

export interface RichCardContent {
  provider: RichCardProvider;
  steps: RichCardStep[];
  detect: RichCardDetect;
  /** When set, the card shows a stream-name input (see RichCardStreamInput). */
  streamInput?: RichCardStreamInput;
  extras?: RichCardExtras;
  docUrl?: string;
  slackUrl?: string;
}

/** Provider builder: given per-org substitutions, returns substituted content. */
export type RichCardBuilder = (subs: CardSubstitutions) => RichCardContent;
