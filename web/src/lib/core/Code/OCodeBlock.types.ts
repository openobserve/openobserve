// Copyright 2026 OpenObserve Inc.
//
// OCodeBlock.types.ts — public types for OCodeBlock, a syntax-highlighted block
// code component with copy, optional secret-masking, and window chrome.
//
// For inline/simple code chips (no highlighting), use OCode instead.

import type { I18nText } from "@/types/i18n";

export type CodeBlockChrome = "terminal" | "editor";

export interface CodeBlockProps {
  /** Raw code to display and copy; the Copy button always copies this. */
  code: string;
  /** Fence language (e.g. "bash", "python"). Auto-detected when omitted. */
  lang?: string;
  /**
   * Masked variant of `code` (e.g. a command with a secret hidden). When set,
   * the block shows it by default and exposes a Reveal/Hide toggle; the Copy
   * button still copies the real `code`, a text selection copies what is shown.
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
  /** Syntax-highlight the code (default true); off renders escaped plain text, for code that is still streaming. */
  highlight?: boolean;
  /** Show the language and actions row (default true); off when the host already labels the code. */
  toolbar?: boolean;
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
  /** Inset the code from the block's edge, for a block with no toolbar above it. */
  padded?: boolean;
  inset?: boolean;
  /**
   * data-test prefix for the toolbar buttons, e.g. "ai-code" yields
   * "ai-code-copy-btn" / "ai-code-reveal-btn". Default: "code-block".
   */
  dataTest?: string;
  /** Name of the credential inside `code`, shown as a toolbar link and in the copy toast. */
  tokenName?: string;
  /** highlight.js output made elsewhere (the assistant's worker); shown instead of highlighting here. The caller vouches it holds only hljs spans. */
  highlightedHtml?: string;
  /** Code longer than this renders as plain text, so one large block cannot stall the tab. */
  highlightMaxChars?: number;
  /** Names the code scroller and makes it a focusable region, for code a keyboard user must scroll. */
  scrollLabel?: I18nText;
  /** Extra classes for the Copy button, e.g. a larger touch target. */
  copyButtonClass?: string;
  /** "aa" raises the language label and the weakest token colours to 4.5:1 (default "default"). */
  contrast?: "default" | "aa";
}

/** `partial` is true for a copy of a text selection, false for a whole-block copy. */
export interface CodeBlockCopyPayload {
  partial: boolean;
}

export interface CodeBlockEmits {
  /** Fired only after the code was copied to the clipboard successfully. */
  (e: "copy", payload: CodeBlockCopyPayload): void;
  /** The toolbar token link was clicked (only rendered when `tokenName` is set). */
  (e: "token-click"): void;
}

export interface CodeBlockSlots {
  /** Extra toolbar actions, rendered left of the copy button. */
  actions?: () => unknown;
}
