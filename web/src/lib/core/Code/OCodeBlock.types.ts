// Copyright 2026 OpenObserve Inc.
// A read-only, highlighted snippet with one 36 px head; inline code is OCode.

export interface CodeBlockProps {
  /** Raw code; Copy always copies this, even while `codeMasked` is shown. */
  code: string;
  /** Skips the highlight cache, so a secret never outlives the block. */
  sensitive?: boolean;
  /** Fence language ("bash", "sql"); auto-detected when omitted. */
  lang?: string;
  /** Masked variant of `code`, shown by default behind a Reveal toggle. */
  codeMasked?: string;
  /** File name in the head; the language shows beside it. */
  filename?: string;
  copyable?: boolean;
  /** Initial wrap state; the head's wrap toggle changes it. */
  wrap?: boolean;
  /** Collapses longer code behind "Show all N lines". */
  maxLines?: number;
  /** Ignored while wrapped: a wrapped line spans more rows than its number. */
  lineNumbers?: boolean;
  /** data-test prefix for the head controls ("<prefix>-copy-btn"). */
  dataTest?: string;
  /** Name of the credential inside `code`, shown as a head link that opens a token picker. */
  tokenName?: string;
}

/** `partial` is true for a copy of a text selection, false for a whole-block copy. */
export interface CodeBlockCopyPayload {
  partial: boolean;
}

export interface CodeBlockEmits {
  (e: "copy", payload: CodeBlockCopyPayload): void;
  (e: "token-click"): void;
}

export interface CodeBlockSlots {
  /** Extra head actions (sm), before Copy. */
  actions?: () => unknown;
}
