export interface RefreshButtonProps {
  /** Unix millisecond timestamp of the last completed query */
  lastRunAt?: number | null;
  /** Mirrors the page's loading state to spin the icon and disable the button */
  loading?: boolean;
  /** Disables the button independently of loading */
  disabled?: boolean;
  /** Reload icon-button style. `outline` draws a border; default is borderless `ghost`. */
  variant?: "ghost" | "outline";
}

export interface RefreshButtonEmits {
  (e: "click", event: MouseEvent): void;
}
