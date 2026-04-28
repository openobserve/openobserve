import type { PopoverRootProps } from "reka-ui";

export type MenuSide = "top" | "right" | "bottom" | "left";
export type MenuAlign = "start" | "center" | "end";

export interface MenuProps {
  /** Controlled open state — bind with v-model:open */
  open?: boolean;
  /** Preferred side of the trigger to display the panel */
  side?: MenuSide;
  /** Alignment of the panel along the trigger axis */
  align?: MenuAlign;
  /** Pixel gap between the trigger edge and the panel */
  sideOffset?: number;
  /** Pixel offset along the alignment axis */
  alignOffset?: number;
  /** Stretch the panel to match the trigger width */
  fit?: boolean;
  /** Disable pointer events on elements outside the panel while open */
  modal?: PopoverRootProps["modal"];
}

export interface MenuEmits {
  (e: "update:open", value: boolean): void;
}

export interface MenuSlots {
  /** Trigger element — rendered as-child into PopoverTrigger */
  trigger?: () => unknown;
  /** Arbitrary panel content */
  default?: () => unknown;
}
