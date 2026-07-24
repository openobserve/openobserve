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

// Generic content schema for the rich, stepped setup card (SetupCardRenderer.vue).
// One typed object describes everything the card renders — hero, ordered steps,
// the live-detection config, and the supplementary accordions — so the component
// stays presentational. Both worlds produce a RichCardContent: AI integrations
// via markdown frontmatter (ai/content/richCard/buildFromMarkdown), and in-repo
// data sources via typed builders (setupCard/content/*, setupCard/registry).

import type { FieldWidth } from "@/lib/forms/Input/OInput.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/**
 * Per-org values substituted into a card's code blocks. `token` is the
 * OpenObserve ingestion token: base64 of `email:<org ingestion passcode>`,
 * WITHOUT the leading "Basic " (snippets add it) — the same Basic-auth token
 * shown on every Data Sources card, not the user's login password.
 */
export interface CardSubstitutions {
  url: string;
  org: string;
  token: string;
}

/** Context of a step → drives both the title chip and the code-block chrome. */
export type StepChipKind = "terminal" | "editor" | "run" | "traces";

/**
 * How a step is marked complete: the user copies its code, a span lands, or the
 * user triggers the step's action button (see RichCardStepAction — used by the
 * cloud-provider cards, whose steps launch a console wizard rather than
 * producing a command to copy).
 */
export type StepCompleteOn = "copy" | "detect" | "action";

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

/**
 * One selectable alternative for a step's code — e.g. the install command for a
 * given OS/arch. When a step has `variants`, the card renders a small toggle and
 * shows the chosen variant's `code` instead of the step's own `code`.
 */
export interface RichCardStepVariant {
  /** Stable id (also the toggle's data-test suffix). */
  id: string;
  /** Toggle label, e.g. "Linux (x86_64)". */
  label: string;
  /** Optional resolved icon URL shown before the label (e.g. an OS logo). */
  icon?: string;
  /**
   * Invert the icon in dark mode — for monochrome black glyphs (e.g. the Apple
   * logo) that would otherwise disappear on a dark background.
   */
  iconInvertDark?: boolean;
  code: RichCardCode;
  /** Optional note rendered under the code for this variant only. */
  note?: string;
}

/**
 * A button that performs the step instead of handing over a command — e.g.
 * "Launch CloudFormation Stack", which opens the AWS console. The renderer is
 * presentational, so it only emits `step-action` with this id; the hosting page
 * owns the behaviour.
 */
export interface RichCardStepAction {
  /** Emitted with the `step-action` event so the page can dispatch. */
  id: string;
  label: string;
  /** OIcon registry name rendered before the label. */
  icon?: IconName;
  /** Renders as a secondary button (default is primary). */
  variant?: "primary" | "secondary";
  /** Greys the button out — e.g. nothing selected yet. */
  disabled?: boolean;
}

export interface RichCardStep {
  /** Stable id (also used as the scroll target for the next-step auto-advance). */
  id: string;
  title: string;
  /** Inline markdown: supports **bold** and `code` only (rendered safely). */
  description: string;
  chip?: RichCardChip;
  code?: RichCardCode;
  /**
   * Selectable code alternatives (e.g. per OS/arch). When present, the card
   * renders a toggle and shows the chosen variant's code; `code` is ignored.
   */
  variants?: RichCardStepVariant[];
  /**
   * Shares the variant selection across steps: steps with the same `variantGroup`
   * read/write one selected id (e.g. "os" so the install OS choice drives the
   * configure command). Variant ids must match across the grouped steps.
   */
  variantGroup?: string;
  /**
   * Whether this step renders its own variant toggle. Default true. Set false on
   * a follower step that should use a shared group's selection without showing a
   * duplicate toggle (its code still follows the group).
   */
  variantToggle?: boolean;
  /**
   * Free-form inputs rendered inside this step (above its code), whose values
   * substitute `{id}` in code blocks reactively (see RichCardInput). Place them
   * on the step they belong to — e.g. host/port on the "configure" step.
   */
  inputs?: RichCardInput[];
  /** Small muted note rendered under the code (e.g. the load_dotenv caveat). */
  note?: string;
  /** Monospace pills rendered after the description (e.g. captured attributes). */
  pills?: string[];
  /**
   * Button that performs this step (cloud-console flows). Rendered after the
   * step's own content and any `#step-<id>` slot.
   */
  action?: RichCardStepAction;
  completeOn: StepCompleteOn;
  /** Marks the step as required (renders a "Required" emphasis on its chip). */
  required?: boolean;
  /** The step that hosts the live status bar + "most likely fix" box. */
  detectionAnchor?: boolean;
}

export interface RichCardDetect {
  streamType: "traces" | "logs" | "metrics";
  /**
   * How `streamName` matches existing streams. "keyword" (used for metrics,
   * which fan out into one stream per metric) treats `streamName` as a substring
   * and counts ANY matching stream's existence as connected; "exact" (default)
   * requires the exact stream and confirms it carries matching rows. See
   * useStreamDetect's StreamDetectConfig.match.
   */
  match?: "exact" | "keyword";
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
}

export interface RichCardExtras {
  /** Packages the installer adds (pills). */
  installs?: string[];
  /** Env vars the installer writes (pills). */
  envVars?: string[];
  /** Code/command shown in the "most likely fix" box when detection stalls. */
  fixSnippet?: string;
  /** Heading of the fix box (after "Most Likely Fix —"). Defaults to the
   *  instrument-ordering wording. */
  fixTitle?: string;
  /** Explanatory paragraph above the fix snippet. Has a sensible default. */
  fixBody?: string;
  /** Highlight language for the fix snippet (e.g. "bash"). Default "python". */
  fixLang?: string;
  /**
   * An alternative, manual path to the same result — e.g. the raw Helm sequence
   * behind Kubernetes' one-line installer. Rendered as a collapsed section below
   * the steps, so the primary path stays the obvious default. Its code goes
   * through the same live substitution as the steps ({stream} and step inputs).
   */
  advanced?: {
    /** Accordion label, e.g. "Advanced Installation (Manual Steps)". */
    label: string;
    /** Optional paragraph above the code (inline markdown: **bold**, `code`). */
    description?: string;
    code: RichCardCode;
  };
  /**
   * How to remove what the install step added. Rendered as the last collapsed
   * section, below troubleshooting — it is a rare, destructive action, so it stays
   * out of the way of the setup flow while remaining discoverable on the page that
   * installed the thing.
   */
  uninstall?: {
    /** Accordion label, e.g. "Uninstall the Agent". */
    label: string;
    /** Optional paragraph above the code (inline markdown: **bold**, `code`). */
    description?: string;
    code: RichCardCode;
  };
  troubleshooting?: { q: string; a: string }[];
}

export interface RichCardProvider {
  name: string;
  tagline: string;
  /** Resolved logo asset URL for light mode (rendered on a neutral tile). */
  logo: string;
  /** Optional resolved logo URL used only in dark mode; falls back to `logo`. */
  logoDark?: string;
  /** Brand accent (clay etc.) — reserved for future per-provider theming. */
  tone: string;
  runtime?: string;
  setupTime?: string;
  /**
   * Hero capability chips shown after runtime/setupTime. When undefined the card
   * keeps the legacy AI "Cost & Tokens Captured" badge; pass an explicit list
   * (possibly empty) to override it — e.g. non-AI data sources pass `[]` for none
   * or `["Metrics", "Logs"]` for what they capture.
   */
  metaBadges?: string[];
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

/**
 * A free-form text input rendered on the card (e.g. SQL Server host/port). Its
 * value replaces `{id}` in the code blocks reactively as the user types — the
 * generic counterpart to RichCardStreamInput (which is also wired into detection).
 */
export interface RichCardInput {
  /** Placeholder key — `{id}` in any code block is replaced with this value. */
  id: string;
  /** Field label, e.g. "SQL Server Host". */
  label: string;
  /** Value used (and shown in code) before the user edits the field. */
  default: string;
  /** Placeholder text (falls back to `default`). */
  placeholder?: string;
  /** Helper text under the field. */
  help?: string;
  /** Width hint passed to OInput (e.g. "sm" | "md"). Defaults to "md". */
  width?: FieldWidth;
}

export interface RichCardContent {
  provider: RichCardProvider;
  steps: RichCardStep[];
  detect: RichCardDetect;
  /** When set, the card shows a stream-name input (see RichCardStreamInput). */
  streamInput?: RichCardStreamInput;
  extras?: RichCardExtras;
  /** Primary "Full integration docs" link in the footer. */
  docUrl?: string;
  /**
   * Additional reference links rendered as real anchors beside `docUrl` — for
   * sources that legitimately have more than one guide (e.g. GCP's Pub/Sub and
   * Google Workspace pages). Without this they end up as unclickable text
   * inside a collapsed accordion, which is how they get lost.
   */
  docLinks?: { label: string; url: string }[];
  slackUrl?: string;
}

/** Provider builder: given per-org substitutions, returns substituted content. */
export type RichCardBuilder = (subs: CardSubstitutions) => RichCardContent;
