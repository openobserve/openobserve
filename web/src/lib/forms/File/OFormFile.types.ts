// Copyright 2026 OpenObserve Inc.

import type { FileProps } from "./OFile.types";

/** A form field holds one File value, so the URL and Paste sources stay on plain OFile. */
export interface FormFileProps extends Omit<
  FileProps,
  "modelValue" | "sources" | "source" | "url" | "text" | "urlPlaceholder" | "textPlaceholder"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
