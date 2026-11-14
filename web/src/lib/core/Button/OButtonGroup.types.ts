/**
 * OButtonGroup.types.ts — single source of truth for all OButtonGroup public types.
 */

import type { ButtonSize } from "./OButton.types";

export interface ButtonGroupProps {
  /** Height shared by every child button that sets no size of its own. */
  size?: ButtonSize;
}

export interface ButtonGroupSlots {
  /** Two to four OButton children of equal weight */
  default?: () => unknown;
}
