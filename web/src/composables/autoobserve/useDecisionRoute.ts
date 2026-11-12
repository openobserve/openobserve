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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/vue-query";
import config from "@/aws-exports";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { useOrgId } from "@/composables/query";
import { toast, toastRecords } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import { alertCalibrationKeys } from "@/services/alert_calibration.querykeys";
import { fenceAlertWrite } from "@/services/alerts.readFence";
import autoobserveDecisions, {
  isRouteDisabled,
  type BatchResult,
  type DecisionFamily,
  type DecisionListParams,
  type DecisionRequest,
  type DecisionResult,
  type DecisionView,
  type PreviewParams,
} from "@/services/autoobserveDecisions";
import { decisionCopy } from "@/components/autoobserve/insight/insightCopy";
import { markUndone } from "@/components/autoobserve/decisions/appliedChanges";

/** One written decision, the org it was written in, and the name its toasts use. */
export interface Written {
  org: string;
  view: DecisionView;
  title: string | null;
}

/** How a dialog writes: the decision route, today's routes, or not known yet. */
export type DecisionTransport = "decision" | "compat" | "pending" | "failed";

const isEnterprise = () => config.isEnterprise === "true";

// The toast store folds equal messages into one record and keeps its first action, so Undo reads the record's whole group.
const undoGroups = new Map<string, Written[]>();

/** Keeps the last page only while the org is the same, so rows from another org never carry actions. */
const keepPreviousInOrg =
  (org: string) =>
  <T>(previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[1] === org ? previous : undefined;

/** `false` while the switch is off or the build has no route, so every surface keeps today's behaviour. */
export const decisionsEnabledQuery = (org: string) =>
  queryOptions({
    queryKey: autoobserveKeys.decisionsEnabled(org),
    queryFn: async ({ signal }): Promise<boolean> => {
      try {
        await autoobserveDecisions.list(org, { state: "active", limit: 1, offset: 0 }, signal);
        return true;
      } catch (error) {
        if (isRouteDisabled(error)) return false;
        throw error;
      }
    },
    staleTime: NORMAL_STALE_TIME,
    retry: false,
  });

export const decisionPreviewQuery = (org: string, params: PreviewParams) =>
  queryOptions({
    queryKey: autoobserveKeys.decisionPreview(org, { ...params }),
    queryFn: async ({ signal }) => (await autoobserveDecisions.preview(org, params, signal)).data,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });

/** `state: null` lists every decision, applied and undone ones included. */
export const decisionsPageQuery = (
  org: string,
  family: DecisionFamily | null,
  limit: number,
  offset: number,
  state: DecisionListParams["state"] | null = "active",
) =>
  queryOptions({
    queryKey: autoobserveKeys.decisionsPage(org, family ?? "all", limit, offset, state ?? "all"),
    queryFn: async ({ signal }) =>
      (
        await autoobserveDecisions.list(
          org,
          {
            ...(state ? { state } : {}),
            ...(family ? { family } : {}),
            limit,
            offset,
          },
          signal,
        )
      ).data,
    placeholderData: keepPreviousInOrg(org),
    staleTime: NORMAL_STALE_TIME,
  });

/** The server's own cap on one list read. */
const LIST_READ_LIMIT = 500;
/** Stops a list that keeps growing between reads from paging forever. */
const LIST_READ_PAGES = 20;

/** Only dismissals and marks are undone from the Dismissed list; an apply's Undo would revert the alert. */
export const isDismissedDecision = (view: DecisionView): boolean => view.action !== "apply";

/** Reads every row the list route returns for these filters, a server page at a time. */
async function readEvery(
  org: string,
  filters: Pick<DecisionListParams, "state" | "family">,
  signal?: AbortSignal,
): Promise<DecisionView[]> {
  const rows: DecisionView[] = [];
  for (let page = 0; page < LIST_READ_PAGES; page += 1) {
    const params = { ...filters, limit: LIST_READ_LIMIT, offset: rows.length };
    const read = (await autoobserveDecisions.list(org, params, signal)).data;
    rows.push(...read.decisions);
    if (!read.decisions.length || rows.length >= read.total) break;
  }
  return rows;
}

/** Every dismissal and mark in force: the server lists applies with them, so this reads all and pages here. */
export const dismissedDecisionsQuery = (org: string, family: DecisionFamily | null) =>
  queryOptions({
    queryKey: autoobserveKeys.dismissedDecisions(org, family ?? "all"),
    queryFn: async ({ signal }): Promise<{ decisions: DecisionView[]; total: number }> => {
      const filters = family ? { state: "active" as const, family } : { state: "active" as const };
      const decisions = (await readEvery(org, filters, signal)).filter(isDismissedDecision);
      return { decisions, total: decisions.length };
    },
    placeholderData: keepPreviousInOrg(org),
    staleTime: NORMAL_STALE_TIME,
  });

/** Every apply, undone ones included: without `state` the server keeps listing an apply after its Undo. */
export const appliedDecisionsQuery = (org: string) =>
  queryOptions({
    queryKey: autoobserveKeys.appliedDecisions(org),
    queryFn: async ({ signal }): Promise<DecisionView[]> =>
      (await readEvery(org, { family: "alert_finding" }, signal)).filter(
        (view) => view.action === "apply",
      ),
    placeholderData: keepPreviousInOrg(org),
    staleTime: NORMAL_STALE_TIME,
  });

export const newRequestId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** The one entry to the decision route for every surface: the switch, writes, the undo toast and undo. */
export function useDecisionRoute(options: { probe?: boolean } = {}) {
  const { t, locale } = useI18nTyped();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const enterprise = isEnterprise();
  // A caller that only records a write it already made needs no probe; a 404 then tells it the route is off.
  const probe = useQuery(() => ({
    ...decisionsEnabledQuery(orgId.value),
    enabled: enterprise && options.probe !== false,
  }));
  /** A failed probe reads as off, so a surface falls back to today's routes instead of erroring. */
  const enabled = computed(() => enterprise && probe.data.value === true);
  /** Only a confirmed off switch, or a build without the route, writes through today's routes. */
  const transport = computed<DecisionTransport>(() => {
    if (!enterprise || probe.data.value === false) return "compat";
    if (probe.data.value === true) return "decision";
    return probe.isError.value ? "failed" : "pending";
  });
  const undoing = ref<ReadonlySet<string>>(new Set());
  const copy = () => decisionCopy(t, locale.value);

  const store = useStore();

  const refreshAfterWrite = (org: string) => {
    void queryClient.invalidateQueries({ queryKey: autoobserveKeys.suggestions(org) });
    void queryClient.invalidateQueries({ queryKey: autoobserveKeys.decisionsPages(org) });
    void queryClient.invalidateQueries({ queryKey: alertCalibrationKeys.dismissals(org) });
  };

  // An apply or its undo rewrites the alert, so a read from before it, saved later, would put the old values back.
  const fencedIfApply = <T>(org: string, action: string | undefined, write: () => Promise<T>) =>
    action === "apply" ? fenceAlertWrite(queryClient, org, write) : write();

  // AlertList renders folders from Vuex, which holds only the selected org's rows.
  const dropFolderRows = (org: string) => {
    if (store?.state.selectedOrganization?.identifier === org)
      void store.dispatch("setAllAlertsListByFolderId", {});
  };

  const setUndoing = (ids: string[], on: boolean) => {
    const next = new Set(undoing.value);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    undoing.value = next;
  };

  /** Undoes every write in one go and says how many were undone; a retry covers only what failed. */
  async function undo(written: Written[]): Promise<boolean> {
    const ids = written.map((w) => w.view.decision_id);
    if (!written.length || ids.some((id) => undoing.value.has(id))) return false;
    setUndoing(ids, true);
    const failed: { item: Written; error: unknown }[] = [];
    const undone: Written[] = [];
    // Another tab or Slack got there first: the server answers 200 with nothing changed.
    const already: Written[] = [];
    try {
      await Promise.all(
        written.map(async (item) => {
          try {
            const result = await fencedIfApply(item.org, item.view.action, () =>
              autoobserveDecisions.undo(item.org, item.view.decision_id, {
                expected_revision: item.view.revision,
                request_id: newRequestId(),
              }),
            );
            const returned = result?.data?.decision;
            const revision = returned?.revision ?? item.view.revision;
            // The undo's own time and actor, so a row undone here reads as it will after a reload.
            const stamp = returned
              ? {
                  decided_at: returned.decided_at,
                  actor: returned.actor,
                  undone_at: returned.undone_at,
                  undone_by: returned.undone_by,
                }
              : {};
            const done = { ...item, view: { ...item.view, revision, ...stamp } };
            (result?.data?.change === "unchanged" ? already : undone).push(done);
          } catch (error) {
            failed.push({ item, error });
          }
        }),
      );
    } finally {
      setUndoing(ids, false);
      for (const org of new Set(written.map((w) => w.org))) refreshAfterWrite(org);
      const undoneApplies = [...undone, ...already].filter((w) => w.view.action === "apply");
      for (const org of new Set(undoneApplies.map((w) => w.org))) dropFolderRows(org);
    }
    // Every Undo (toast, row, retry) passes here, so this session's What I've changed rows follow one source.
    markUndone([...undone, ...already]);
    if (written[0].org !== orgId.value) return !failed.length;
    if (!failed.length && !undone.length) {
      toast({ message: copy().alreadyUndone(), variant: "info" });
      return true;
    }
    if (!failed.length) {
      toast({
        message: copy().undone(
          undone.length,
          undone.length === 1 ? undone[0].title : null,
          undone.every((w) => w.view.action === "apply"),
        ),
        variant: "success",
      });
      return true;
    }
    const retryable = failed.filter((f) => copy().undoRetryable(f.error)).map((f) => f.item);
    const notice = copy().undoOutcome(
      written.length,
      failed.map((f) => ({ title: f.item.title, error: f.error })),
    );
    if (retryable.length) toastUndoing(retryable, notice.text, notice.variant, copy().retry());
    else toast({ message: notice.text, variant: notice.variant });
    return false;
  }

  /** Every write ends in one toast whose Undo sends the revision the write returned; a write from an org left behind shows none. */
  function toastWritten(written: Written[], message: ReturnType<typeof t>) {
    if (!written.length || written[0].org !== orgId.value) return;
    toastUndoing(written, message, "success", copy().undo());
  }

  /** A toast whose action undoes its items; equal toasts fold into one record, so its action undoes every folded item. */
  function toastUndoing(
    items: Written[],
    message: ReturnType<typeof t>,
    variant: "success" | "error" | "warning",
    label: ReturnType<typeof t>,
  ) {
    for (const key of undoGroups.keys()) {
      if (!toastRecords.some((r) => r.id === key && r.open)) undoGroups.delete(key);
    }
    let key = "";
    let close: (() => void) | null = null;
    const handle = toast({
      message,
      variant,
      action: {
        label,
        handler: () => {
          const group = undoGroups.get(key);
          undoGroups.delete(key);
          // The undo ends in its own toast, so this one must not keep a live-looking Undo.
          close?.();
          if (group) void undo(group);
        },
      },
    });
    close = handle;
    key = handle.id;
    const group = undoGroups.get(key);
    if (group) group.push(...items);
    else undoGroups.set(key, [...items]);
  }

  async function decide(body: DecisionRequest, title: string | null): Promise<DecisionResult> {
    const org = orgId.value;
    const result = (
      await fencedIfApply(org, body.action, () => autoobserveDecisions.decide(org, body))
    ).data;
    refreshAfterWrite(org);
    if (body.action === "apply") dropFolderRows(org);
    const view = { ...result.decision, via: body.applied_via ?? result.decision.via };
    toastWritten([{ org, view: result.decision, title }], copy().saved(view, title));
    return result;
  }

  async function decideBatch(
    items: DecisionRequest[],
    titleOf: (id: string) => string | null,
  ): Promise<BatchResult> {
    const org = orgId.value;
    const result = (await autoobserveDecisions.decideBatch(org, items)).data;
    refreshAfterWrite(org);
    const written = result.results.flatMap((item) =>
      item.result && item.result.change !== "unchanged"
        ? [{ org, view: item.result.decision, title: titleOf(item.id) }]
        : [],
    );
    toastWritten(
      written,
      written.length === 1
        ? copy().saved(written[0].view, written[0].title)
        : copy().marked(written.length),
    );
    return result;
  }

  return {
    enabled,
    transport,
    probe,
    decide,
    decideBatch,
    undo,
    isUndoing: (decisionId: string) => undoing.value.has(decisionId),
  };
}
