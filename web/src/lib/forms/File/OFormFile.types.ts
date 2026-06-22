// Copyright 2026 OpenObserve Inc.

import type { FileProps } from "./OFile.types";

export interface FormFileProps extends Omit<FileProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
