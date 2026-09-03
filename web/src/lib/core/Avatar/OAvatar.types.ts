// Copyright 2026 OpenObserve Inc.

/** Diameter. `md` (1.5rem) is the inline-beside-text default. */
export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** The identity — an email address or a display name. Drives the initials. */
  value?: string;
  /** Display name, when the caller knows one and `value` is an email. */
  name?: string;
  size?: AvatarSize;
}
