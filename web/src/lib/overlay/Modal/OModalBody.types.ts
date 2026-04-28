export interface ModalBodyProps {
  /** Enable vertical scrolling when content overflows the modal height */
  scrollable?: boolean;
}

export interface ModalBodySlots {
  default?: () => unknown;
}
