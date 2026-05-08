export interface RefreshButtonProps {
  /** Unix millisecond timestamp of the last completed query */
  lastRunAt?: number | null
  /** Mirrors the page's loading state to spin the icon and disable the button */
  loading?: boolean
  /** Disables the button independently of loading */
  disabled?: boolean
}

export interface RefreshButtonEmits {
  (e: 'click', event: MouseEvent): void
}
