export interface ModalHeaderProps {
  /** Show the default × close button */
  showClose?: boolean;
}

export interface ModalHeaderEmits {
  (e: "close"): void;
}

export interface ModalHeaderSlots {
  /** Title text or element — rendered inside DialogTitle for accessibility */
  default?: () => unknown;
  /** Custom close icon — replaces default × SVG inside the close button */
  close?: () => unknown;
}
