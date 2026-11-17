// Copyright 2026 OpenObserve Inc.

/** Diameter. `md` (1.5rem) is the inline-beside-text default. */
export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** The identity — an email address or a display name. Drives the initials. */
  value?: string;
  /** Display name, when the caller knows one and `value` is an email. */
  name?: string;
  size?: AvatarSize;
  /** Hover shows the name and the address; off where an enclosing tooltip already names the person. */
  tooltip?: boolean;
}

export interface AvatarGroupPerson {
  /** Email or display name, as `OAvatar.value`. */
  value: string;
  name?: string;
}

export interface AvatarGroupProps {
  people: AvatarGroupPerson[];
  /** Faces drawn before the rest collapse into a "+N" chip. */
  max?: number;
  size?: AvatarSize;
}
