// Copyright 2026 OpenObserve Inc.

import type { FileValidator } from "./OFile.types";
import { raw, type TranslateFn } from "@/types/i18n";

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** An OFile `validate` that rejects a file whose text does not parse as JSON (guideline U1). */
export function createJsonFileValidator(t: TranslateFn): FileValidator {
  return async (file) => {
    try {
      JSON.parse(await readText(file));
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return t("components.file.invalidJson", { detail: raw(detail) });
    }
  };
}
