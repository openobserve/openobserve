/**
 * OCode — inline and block monospace code display.
 *
 * Use OCode when you need to display:
 *  - Cron expressions ("0 0 * * *")
 *  - Stream IDs, resource identifiers
 *  - SQL / PromQL / VRL snippets
 *  - Config values, API keys (truncated), environment names
 *  - Terminal commands or paths
 *
 * For non-executable identifiers (field names, stream names shown as plain
 * text), prefer `<OText variant="mono">` which has no border or background.
 */
export interface CodeProps {
  /**
   * Block-level display: full-width pre/code with scroll for long lines.
   * When false (default): inline code chip with subtle background border.
   */
  block?: boolean;

  /**
   * Show a copy-to-clipboard button.
   * The button copies the rendered text content of the code element.
   */
  copyable?: boolean;

  /**
   * Truncate with ellipsis. Only applies to inline (`block=false`) mode.
   * In block mode, content scrolls horizontally instead.
   */
  truncate?: boolean;
}

export interface CodeSlots {
  default(): unknown;
}
