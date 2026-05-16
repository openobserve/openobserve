// Copyright 2026 OpenObserve Inc.

import type { FileProps, FileValue } from "./OFile.types";
import type { FieldValidator } from "../Form/OForm.types";

export interface FormFileProps extends Omit<FileProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<FileValue>[];
}
