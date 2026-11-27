// Copyright 2026 OpenObserve Inc.

import type { FileValidator } from "@/lib/forms/File/OFile.types";
import { createJsonFileValidator } from "@/lib/forms/File/validateJsonFile";
import type { TranslateFn } from "@/types/i18n";

/** Refuses a semantic groups import file that is not JSON, or not a list of `{ id, display, fields }`. */
export function createSemanticGroupsFileValidator(t: TranslateFn): FileValidator {
  return createJsonFileValidator(t, (value) => {
    const groups = Array.isArray(value) ? value : [value];
    const valid = groups.every(
      (group: any) => group && group.id && group.display && Array.isArray(group.fields),
    );
    return valid ? null : t("alerts.import.invalidSemanticGroupFormat");
  });
}
