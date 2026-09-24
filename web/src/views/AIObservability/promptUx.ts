// Copyright 2026 OpenObserve Inc.
import { raw, type I18nText } from "@/types/i18n";

export function promptErrorText(error: unknown, fallback: I18nText): I18nText {
  if (error && typeof error === "object" && "response" in error) {
    const response = error.response;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (data && typeof data === "object" && "message" in data && typeof data.message === "string")
        return raw(data.message);
    }
  }
  return error instanceof Error ? raw(error.message) : fallback;
}
