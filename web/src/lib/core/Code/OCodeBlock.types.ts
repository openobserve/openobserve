// Copyright 2026 OpenObserve Inc.
//
// OCodeBlock.types.ts — public types for OCodeBlock, a syntax-highlighted block
// code component with copy, optional secret-masking, and window chrome.
//
// For inline/simple code chips (no highlighting), use OCode instead.

import type { I18nText } from "@/types/i18n";

export type CodeBlockChrome = "terminal" | "editor";

export interface CodeBlockProps {
  /** Raw code to display and copy. Copy always uses this, never the masked or
   *  highlighted variant. */
  code: string;
  /** Fence language (e.g. "bash", "python"). Auto-detected when omitted. */
  lang?: string;
  /**
   * Masked variant of `code` (e.g. a command with a secret hidden). When set,
   * the block shows it by default and exposes a Reveal/Hide toggle; copy still
   * copies the real `code`.
   */
  codeMasked?: string;
  /**
   * Window chrome. "terminal" → macOS traffic-light dots + a "Terminal" label.
   * "editor" → a filename tab. Omitted → a plain language label.
   */
  chrome?: CodeBlockChrome;
  /** Filename shown in the "editor" chrome tab (falls back to the language). */
  filename?: string;
  /** Show the copy button. Default: true. */
  copyable?: boolean;
  /** Toast shown on a successful copy. */
  copyMessage?: I18nText;
  /** Tooltips for the reveal/hide toggle (when `codeMasked` is set). */
  revealTooltip?: I18nText;
  hideTooltip?: I18nText;
  /**
   * Wrap long lines instead of scrolling horizontally. Use when the code is
   * meant to be READ in place (a query shown for confirmation) rather than
   * scanned — a horizontal scrollbar hides the end of the statement, which is
   * usually the part that matters.
   */
  wrap?: boolean;
  /**
   * Cap the visible height at roughly this many lines and scroll vertically past
   * it. Keeps a long query from pushing the rest of a dialog off-screen while
   * still showing enough to read at a glance.
   */
  maxLines?: number;
  /**
   * Show a line-number gutter, for code the reader needs to talk about or scan
   * by position — a config file, a diff, an error pointing at a line.
   *
   * Ignored when `wrap` is set: a wrapped line occupies more rows than its
   * number accounts for, so the two columns would drift apart.
   */
  lineNumbers?: boolean;
  /**
   * data-test prefix for the toolbar buttons, e.g. "ai-code" yields
   * "ai-code-copy-btn" / "ai-code-reveal-btn". Default: "code-block".
   */
  dataTest?: string;
}

export interface CodeBlockEmits {
  /** Fired after the raw code is copied to the clipboard. */
  (e: "copy"): void;
}

export interface CodeBlockSlots {
  /** Extra toolbar actions, rendered left of the copy button. */
  actions?: () => unknown;
}
