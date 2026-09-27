export interface RefreshButtonProps {
  /** Unix millisecond timestamp of the last completed query */
  lastRunAt?: number | null;
  /** Mirrors the page's loading state to spin the icon and disable the button */
  loading?: boolean;
  /** Disables the button independently of loading */
  disabled?: boolean;
  /** Reload icon-button style. `outline` draws a border; default is borderless `ghost`. */
  variant?: "ghost" | "outline";
  /** `split` (default) shows a dot and the age beside the button; `inline` drops the dot and puts the age inside it. */
  layout?: "split" | "inline";
  /** Overrides the button's `data-test` so a page keeps its own selector. */
  dataTest?: string;
  /** Registry id, so the tooltip shows the page's refresh shortcut. */
  shortcutId?: string;
}

export interface RefreshButtonEmits {
  (e: "click", event: MouseEvent): void;
}
