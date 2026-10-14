//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref, shallowRef } from "vue";
import { useStore } from "vuex";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import searchService from "@/services/search";
import shortURLService from "@/services/short_url";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { searchState } from "@/composables/useLogs/searchState";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { trustworthyFields } from "@/utils/logs/detailRowMatch";
import {
  buildLineLinkQuery,
  buildResolveRequest,
  decideCopyLink,
  isWideStream,
  lineLinkEligibility,
  lineStreamOf,
  readRowTimestamp,
  type CopyLinkDecision,
  type LogRow,
  type ResolveResult,
} from "@/utils/logs/logPermalink";

export const lineLinkPopover = shallowRef<{ url: string; source: LineLinkSource } | null>(null);

export const lineLinkBusy = ref(false);

const SCOPE_CHANGED = "line-link-scope-changed";

let parser: Parser | null = null;

export type LineLinkSource = "drawer" | "menu";

export type LineLinkState =
  { kind: "hidden" } | { kind: "disabled"; reason: I18nText } | { kind: "enabled" };

export interface LineLinkResult {
  url: string;
  decision: CopyLinkDecision;
  lookupFailed: boolean;
  shortFailed: boolean;
}

interface ExecutedLike {
  signature?: { sqlMode?: boolean; query?: string };
  req?: { encoding?: string; query?: { sql?: string; query_fn?: string | null } };
}

function writeUrlToClipboard(url: Promise<string>): Promise<void> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!clipboard?.write || typeof Item !== "function" || globalThis.isSecureContext === false) {
    url.catch(() => undefined);
    return Promise.reject(new Error("clipboard-unavailable"));
  }
  try {
    const blob = url.then((text) => new Blob([text], { type: "text/plain" }));
    return clipboard.write([new Item({ "text/plain": blob })]);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function closeLineLinkPopover(): void {
  lineLinkPopover.value = null;
}

export function useLogLineLink() {
  const store = useStore();
  const { t } = useI18nTyped();
  const { searchObj } = searchState();
  const autoRun = useLogsAutoRun();
  const { generateURLQuery } = logsUtils();

  const timestampColumn = (): string => store.state.zoConfig?.timestamp_column || "_timestamp";
  const executed = (): ExecutedLike | null =>
    (searchObj.meta.executed as ExecutedLike | null | undefined) ?? null;

  const executedSql = (): string => {
    const record = executed();
    if (record?.signature?.query !== undefined) return record.signature.query;
    return String(searchObj.data.query ?? "");
  };

  const functionActive = (): boolean => {
    const record = executed();
    if (record?.req?.query) return !!record.req.query.query_fn;
    return searchObj.data.tempFunctionContent !== "" && !!searchObj.meta.showTransformEditor;
  };

  const sqlMode = (): boolean => executed()?.signature?.sqlMode ?? !!searchObj.meta.sqlMode;

  const lineLinkState = (row: unknown): LineLinkState => {
    const viewMode = searchObj.meta.logsVisualizeToggle ?? "logs";
    const eligibility = lineLinkEligibility({
      viewMode,
      functionActive: functionActive(),
      sqlMode: sqlMode(),
      parsedSql: sqlMode() ? parseSql(executedSql()) : null,
      timestampColumn: timestampColumn(),
      streamType: searchObj.data.stream.streamType || "logs",
      row: hasRow(row) ? row : {},
    });
    if (eligibility.kind === "hidden") return eligibility;
    const g1 = autoRun.persistReason("logs", "copy-line-link");
    if (g1) return { kind: "disabled", reason: g1 };
    if (eligibility.kind === "disabled") {
      return { kind: "disabled", reason: t(eligibility.reasonKey) };
    }
    return { kind: "enabled" };
  };

  const schemaFieldCount = (stream: string): number => {
    const entry = (searchObj.data.streamResults?.list ?? []).find(
      (item: { name?: string }) => item?.name === stream,
    ) as { schema?: unknown[] } | undefined;
    if (Array.isArray(entry?.schema)) return entry.schema.length;
    return (searchObj.data.stream.selectedStreamFields ?? []).filter(
      (field: { streams?: string[] }) => !field?.streams || field.streams.includes(stream),
    ).length;
  };

  const trustworthy = () => {
    const record = executed();
    if (!record?.req?.query) return "all" as const;
    return trustworthyFields(
      {
        sqlMode: sqlMode(),
        encoding: record.req.encoding,
        query: record.req.query,
      },
      { timestampColumn: timestampColumn() },
    );
  };

  const resolveAtCopy = async (
    orgIdentifier: string,
    stream: string,
    ts: number,
    id: string | undefined,
  ) => {
    const request = buildResolveRequest({
      orgIdentifier,
      stream,
      ts,
      id,
      regions: searchObj.meta.regions ?? [],
      clusters: searchObj.meta.clusters ?? [],
    });
    try {
      const response = await searchService.search(
        request.options,
        request.searchType,
        false,
        request.useCache,
      );
      return { status: response.status, data: response.data } as ResolveResult;
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } })?.response;
      return { status: response?.status ?? null, data: response?.data } as ResolveResult;
    }
  };

  const shareBase = (): string => window.location.origin + window.location.pathname;

  const toQueryString = (query: Record<string, unknown>): string =>
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");

  const shorten = async (
    orgIdentifier: string,
    webUrl: string,
    url: string,
  ): Promise<{ url: string; failed: boolean }> => {
    if (!webUrl) return { url, failed: false };
    try {
      const response = await shortURLService.create(orgIdentifier, url);
      const short = (response?.data as { short_url?: string } | undefined)?.short_url;
      return short ? { url: short, failed: false } : { url, failed: true };
    } catch {
      return { url, failed: true };
    }
  };

  const scopeKey = (): string =>
    JSON.stringify([
      store.state.selectedOrganization?.identifier,
      searchObj.data.stream.streamType,
      [...(searchObj.data.stream.selectedStream ?? [])],
    ]);

  const assertScope = (key: string): void => {
    if (scopeKey() !== key) throw new Error(SCOPE_CHANGED);
  };

  const buildLineLink = async (row: LogRow): Promise<LineLinkResult> => {
    const stream = lineStreamOf(row, [...(searchObj.data.stream.selectedStream ?? [])]);
    const ts = readRowTimestamp(row, timestampColumn());
    if (!stream || ts === null) throw new Error("line-link-ineligible");
    const id = row._o2_id === undefined || row._o2_id === null ? undefined : String(row._o2_id);
    const wide = isWideStream({
      schemaFieldCount: schemaFieldCount(stream),
      quickModeNumFields: store.state.zoConfig?.quick_mode_num_fields,
      quickModeForceEnabled: store.state.zoConfig?.quick_mode_force_enabled,
    });
    const scope = scopeKey();
    const org = String(store.state.selectedOrganization.identifier);
    const decideInput = {
      stream,
      ts,
      row,
      timestampColumn: timestampColumn(),
      trustworthy: trustworthy(),
      wide,
      allFieldsName: store.state.zoConfig?.all_fields_name,
    };
    const shareQuery: Record<string, unknown> = { ...generateURLQuery(true) };
    delete shareQuery.type;
    const base = shareBase();
    const webUrl = String(store.state.zoConfig?.web_url ?? "").trim();
    const skipResolve = wide && id === undefined;
    const resolve = skipResolve ? null : await resolveAtCopy(org, stream, ts, id);
    assertScope(scope);
    const decision = decideCopyLink({ ...decideInput, resolve });
    const query = buildLineLinkQuery(shareQuery, decision.link);
    if (!query) throw new Error("line-link-invalid");
    const shortened = await shorten(org, webUrl, `${base}?${toQueryString(query)}`);
    assertScope(scope);
    return {
      url: shortened.url,
      decision,
      lookupFailed: !skipResolve && resolve?.status !== 200,
      shortFailed: shortened.failed,
    };
  };

  const lifetimeDays = (): number | null => {
    const days = Number(store.state.zoConfig?.short_url_retention_days);
    return Number.isFinite(days) && days > 0 ? days : null;
  };

  const announceCopied = (result: LineLinkResult) => {
    if (result.shortFailed) {
      toast({ variant: "warning", message: t("search.linePermalink.toastShortFailed") });
      return;
    }
    if (result.decision.kind === "timestamp") {
      const key = result.lookupFailed
        ? "search.linePermalink.toastLookupFailed"
        : result.decision.toastKey;
      toast({ variant: "warning", message: t(key) });
      return;
    }
    const days = lifetimeDays();
    toast({
      variant: "success",
      message:
        days === null
          ? t("search.linePermalink.toastCopied")
          : t("search.linePermalink.toastCopiedValid", { days }, days),
    });
  };

  const copyLineLink = (row: unknown, source: LineLinkSource): Promise<void> => {
    if (lineLinkBusy.value || !hasRow(row)) return Promise.resolve();
    if (lineLinkState(row).kind !== "enabled") return Promise.resolve();
    lineLinkBusy.value = true;
    closeLineLinkPopover();
    const pending = buildLineLink(row);
    const url = pending.then((result) => result.url);
    return writeUrlToClipboard(url)
      .then(() => pending.then(announceCopied))
      .catch(() =>
        pending.then(
          (result) => {
            lineLinkPopover.value = { url: result.url, source };
            if (result.shortFailed) announceCopied(result);
          },
          (error: unknown) => {
            const key =
              (error as Error | undefined)?.message === SCOPE_CHANGED
                ? "search.linePermalink.toastScopeChanged"
                : "search.linePermalink.toastFailed";
            toast({ variant: "error", message: t(key) });
          },
        ),
      )
      .finally(() => {
        lineLinkBusy.value = false;
      });
  };

  return { lineLinkState, copyLineLink, buildLineLink };
}

export function resetLineLinkForTests(): void {
  lineLinkPopover.value = null;
  lineLinkBusy.value = false;
}

function parseSql(sql: string): unknown {
  if (!sql.trim()) return null;
  try {
    parser ??= new Parser();
    return parser.astify(sql);
  } catch {
    return null;
  }
}

function hasRow(value: unknown): value is LogRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
