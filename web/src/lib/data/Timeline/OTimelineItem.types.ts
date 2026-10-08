/**
 * Visual emphasis variants — map to dot background colours.
 *
 * | Variant       | Token                            |
 * |---------------|----------------------------------|
 * | primary       | --color-timeline-dot-primary     |
 * | success       | --color-timeline-dot-success     |
 * | destructive   | --color-timeline-dot-destructive |
 * | info          | --color-timeline-dot-info        |
 * | muted         | --color-timeline-dot-muted       |
 */
import type { I18nText } from "@/types/i18n";

export type TimelineItemVariant = "primary" | "success" | "destructive" | "info" | "muted";

export interface TimelineItemProps {
  /** Header text rendered in bold above the subtitle. */
  title?: I18nText;
  /** Secondary line rendered below the title in muted text. */
  subtitle?: I18nText;
  /**
   * Material icon name rendered inside the dot.
   * Uses the `material-icons` font — pass the icon ligature string
   * (e.g. "check_circle", "play_arrow").
   * When omitted the dot is rendered as a plain filled circle.
   */
  icon?: string;
  /**
   * Short text rendered IN the node, as a pill, instead of a dot.
   *
   * For timelines whose rail carries the axis itself — an escalation ladder's
   * delays ("0m", "+20m"), a duration, a step number. The connector stays
   * centred under a pill of any width, so a rail may mix pills and dots.
   * Keep it to a few characters: this is a rail, not a column.
   */
  label?: I18nText;
  /**
   * Wraps the content column in a card, so each entry reads as its own block
   * rather than as text floating beside a rail. Use when entries carry several
   * lines; a one-line log reads better unframed.
   */
  framed?: boolean;
  /** Controls dot background colour. Defaults to "primary". */
  variant?: TimelineItemVariant;
}

export interface TimelineItemSlots {
  /** Optional extra content rendered below the subtitle row. */
  default?: () => unknown;
  /** Overrides the `subtitle` prop's text — same row, for a subtitle that needs a link or other markup inline. */
  subtitle?: () => unknown;
}
