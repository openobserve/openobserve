export interface RevealProps {
  /** False shows the skeleton; flipping to true swaps in the content with the shared fade. */
  ready: boolean;
  /** Root element for both states. Default: "div" */
  as?: string;
}
