export type ModalVariant = "modal" | "drawer";
export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps {
  /** Controlled open state — bind with v-model:open */
  open?: boolean;
  /** Prevent closing on Escape key and overlay click */
  persistent?: boolean;
  /** Layout variant — centered panel or inline-end drawer */
  variant?: ModalVariant;
  /** Panel width — sm 384px | md 512px | lg 672px | xl 896px | full */
  size?: ModalSize;
}

export interface ModalEmits {
  (e: "update:open", value: boolean): void;
}

export interface ModalSlots {
  /** Optional trigger element — rendered as-child into DialogTrigger */
  trigger?: () => unknown;
  /** Panel content — compose with OModalHeader, OModalBody, OModalFooter */
  default?: () => unknown;
}
