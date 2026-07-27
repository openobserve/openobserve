// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * useQueryError — shared composable for parsing and classifying backend query errors.
 *
 * Used by logs, metrics, traces, dashboards, RUM, and alerts to produce a
 * consistent, human-readable error presentation from the raw backend response.
 *
 * Accepts MaybeRefOrGetter for all inputs so it works with:
 *   - defineProps() reactive objects  → pass getter:  () => props.errorCode
 *   - Vuex store / composable state   → pass computed: computed(() => searchObj.data.errorCode)
 *   - Static strings / numbers        → pass plain value directly
 *
 * Example:
 *   const err = useQueryError({
 *     errorCode: () => props.errorCode,
 *     errorMsg:  () => props.errorMsg,
 *     errorDetail: () => props.errorDetail,
 *   });
 */

import DOMPurify from "dompurify";
import { computed, ref, type ComputedRef, type Ref, type MaybeRefOrGetter, toValue } from "vue";
import { useI18n } from "vue-i18n";

// ── Types ──────────────────────────────────────────────────────────────────

export interface QueryErrorInput {
  /** Backend error code. Accepts number, numeric string, or undefined (→ 0). */
  errorCode?: MaybeRefOrGetter<number | string | undefined>;
  /**
   * Raw error message from the backend. May contain HTML tags and an embedded
   * TraceID as <span class="text-subtitle1">TraceID: abc123</span>.
   */
  errorMsg?: MaybeRefOrGetter<string | undefined>;
  /** SQL parse positions, DataFusion detail, or other raw technical detail. */
  errorDetail?: MaybeRefOrGetter<string | undefined>;
}

export interface QueryErrorResult {
  /** Normalized numeric error code (0 = generic). */
  errorCode: ComputedRef<number>;
  /** Plain text of the error message — HTML stripped, TraceID removed. */
  cleanMessage: ComputedRef<string>;
  /**
   * First sentence (≤ 160 chars) — safe to show inline without overwhelming
   * the UI when the backend appends the full list of valid field names.
   */
  summaryLine: ComputedRef<string>;
  /**
   * Everything beyond the summary line + raw errorDetail.
   * Shown in the collapsible "Show details" section.
   */
  detailBody: ComputedRef<string>;
  /** Whether there is expandable detail content. */
  hasDetail: ComputedRef<boolean>;
  /** Whether there is any displayable content at all. */
  hasAnyContent: ComputedRef<boolean>;
  /** TraceID extracted from the backend HTML response. */
  traceId: ComputedRef<string>;
  /** True for error codes where "Fix the query" is the right recovery action. */
  isQueryError: ComputedRef<boolean>;
  /** Default i18n title for the error code. */
  defaultTitle: ComputedRef<string>;
  /** Default i18n description for the error code. */
  defaultDescription: ComputedRef<string>;
  /** UI toggle for the expandable detail section. */
  showDetail: Ref<boolean>;
  /** Copy all error detail to the clipboard. */
  copyErrorDetails: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Error codes where "Fix the query" is the correct recovery action. */
export const QUERY_ERROR_CODES = new Set([20001, 20004, 20005, 20007, 20008]);

/** Per-code i18n keys. Falls back to generic keys for unknown codes. */
const ERROR_META: Record<number, { titleKey: string; descKey: string }> = {
  20001: {
    titleKey: "queryError.sqlError",
    descKey: "queryError.sqlErrorDesc",
  },
  20002: {
    titleKey: "queryError.streamNotFound",
    descKey: "queryError.streamNotFoundDesc",
  },
  20003: {
    titleKey: "queryError.ftsNotConfigured",
    descKey: "queryError.ftsNotConfiguredDesc",
  },
  20004: {
    titleKey: "queryError.fieldNotFound",
    descKey: "queryError.fieldNotFoundDesc",
  },
  20005: {
    titleKey: "queryError.functionNotDefined",
    descKey: "queryError.functionNotDefinedDesc",
  },
  20006: {
    titleKey: "queryError.dataUnavailable",
    descKey: "queryError.dataUnavailableDesc",
  },
  20007: {
    titleKey: "queryError.dataTypeMismatch",
    descKey: "queryError.dataTypeMismatchDesc",
  },
  20008: {
    titleKey: "queryError.executionError",
    descKey: "queryError.executionErrorDesc",
  },
  10001: {
    titleKey: "queryError.serverError",
    descKey: "queryError.serverErrorDesc",
  },
};

// ── Composable ─────────────────────────────────────────────────────────────

export function useQueryError(input: QueryErrorInput): QueryErrorResult {
  const { t } = useI18n();
  const showDetail = ref(false);

  // ── Input normalization ────────────────────────────────────────────────

  const errorCode = computed<number>(() => {
    const raw = toValue(input.errorCode);
    if (raw === undefined || raw === null) return 0;
    const n = typeof raw === "string" ? parseInt(raw, 10) : raw;
    return isNaN(n) ? 0 : n;
  });

  const rawMsg = computed<string>(() => toValue(input.errorMsg) ?? "");
  const rawDetail = computed<string>(() => toValue(input.errorDetail) ?? "");

  // ── Message extraction ─────────────────────────────────────────────────

  /**
   * TraceID embedded by the backend as:
   *   <span class="text-subtitle1">TraceID: abc123def456</span>
   */
  const traceId = computed<string>(() => {
    const match = rawMsg.value.match(/TraceID:\s*([a-f0-9A-F-]+)/i);
    return match ? match[1] : "";
  });

  /** Human-readable message — all HTML stripped, TraceID fragment removed. */
  const cleanMessage = computed<string>(() => {
    if (!rawMsg.value) return "";
    return DOMPurify.sanitize(rawMsg.value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
      .replace(/TraceID:\s*[a-f0-9A-F-]+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  });

  /**
   * First sentence of cleanMessage, capped at 160 chars.
   *
   * The backend often appends the full list of valid field names after the
   * first sentence (e.g. "No field named X. Valid fields are …"). Showing
   * only the first sentence keeps the summary line tight while the full list
   * is available in the expandable detail section.
   */
  const summaryLine = computed<string>(() => {
    const msg = cleanMessage.value;
    if (!msg) return "";
    const dotIdx = msg.indexOf(". ");
    if (dotIdx > 0 && dotIdx < 160) return msg.slice(0, dotIdx + 1);
    if (msg.length <= 160) return msg;
    return msg.slice(0, 157) + "…";
  });

  /**
   * Everything past the first sentence + the raw errorDetail.
   * Displayed in the collapsible "Show details" panel.
   */
  const detailBody = computed<string>(() => {
    const msg = cleanMessage.value;
    const dotIdx = msg.indexOf(". ");
    const remainder = dotIdx > 0 && dotIdx < 160 ? msg.slice(dotIdx + 2).trim() : "";
    const parts = [remainder, rawDetail.value].filter(Boolean);
    return parts.join("\n\n");
  });

  const hasDetail = computed(() => detailBody.value.length > 0);

  const hasAnyContent = computed(() => !!(cleanMessage.value || rawDetail.value || traceId.value));

  // ── Classification ─────────────────────────────────────────────────────

  const isQueryError = computed(() => QUERY_ERROR_CODES.has(errorCode.value));

  // ── Title / description ────────────────────────────────────────────────

  const meta = computed(
    () =>
      ERROR_META[errorCode.value] ?? {
        titleKey: "queryError.generic",
        descKey: "queryError.genericDesc",
      },
  );

  const defaultTitle = computed(() => t(meta.value.titleKey));
  const defaultDescription = computed(() => t(meta.value.descKey));

  // ── Clipboard ──────────────────────────────────────────────────────────

  const copyErrorDetails = () => {
    const parts: string[] = [];
    if (cleanMessage.value) parts.push(cleanMessage.value);
    if (rawDetail.value) parts.push(rawDetail.value);
    if (traceId.value) parts.push(`TraceID: ${traceId.value}`);
    navigator.clipboard?.writeText(parts.join("\n"));
  };

  return {
    errorCode,
    cleanMessage,
    summaryLine,
    detailBody,
    hasDetail,
    hasAnyContent,
    traceId,
    isQueryError,
    defaultTitle,
    defaultDescription,
    showDetail,
    copyErrorDetails,
  };
}
