/**
 * Visual emphasis variants — map to dot background colours.
 *
 * | Variant       | Token                          | Legacy color prop        |
 * |---------------|--------------------------------|--------------------------|
 * | primary       | --color-timeline-dot-primary   | color="primary" (default)|
 * | success       | --color-timeline-dot-success   | color="positive"         |
 * | destructive   | --color-timeline-dot-destructive| color="negative"        |
 * | info          | --color-timeline-dot-info      | color="blue"             |
 * | muted         | --color-timeline-dot-muted     | color="grey"             |
 */
export type TimelineItemVariant =
  | "primary"
  | "success"
  | "destructive"
  | "info"
  | "muted";

export interface TimelineItemProps {
  /** Header text rendered in bold above the subtitle. */
  title?: string;
  /** Secondary line rendered below the title in muted text. */
  subtitle?: string;
  /**
   * Material icon name rendered inside the dot.
   * Uses the `material-icons` font — pass the icon ligature string
   * (e.g. "check_circle", "play_arrow").
   * When omitted the dot is rendered as a plain filled circle.
   */
  icon?: string;
  /** Controls dot background colour. Defaults to "primary". */
  variant?: TimelineItemVariant;
}

export interface TimelineItemSlots {
  /** Optional extra content rendered below the subtitle row. */
  default?: () => unknown;
}
