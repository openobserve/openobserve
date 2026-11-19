<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  The starter's Library pane: the ready-made alerts that match this org's data, one row each.
  A row click opens the form prefilled; ticked rows go to the host's bulk add.
-->
<template>
  <div
    class="flex min-h-0 flex-col gap-2"
    data-test="alert-starter-library-pane"
    @pointerdown="markActed"
    @keydown="markActed"
    @wheel.passive="markActed"
  >
    <div class="flex shrink-0 items-center gap-2">
      <OSearchInput
        v-model="search"
        size="sm"
        class="min-w-0 flex-1"
        :debounce="150"
        :placeholder="t('alertStarter.library.searchPlaceholder')"
        data-test="alert-starter-library-search"
      />
      <!-- Sized to its value, so the search keeps the rest of the row. -->
      <div class="flex max-w-1/2 shrink-0">
        <StarterScopeSelect v-model="scope" />
      </div>
    </div>

    <div
      v-if="!failed"
      class="flex min-h-7 shrink-0 flex-wrap items-center gap-1.5"
      role="group"
      :aria-label="t('alertStarter.library.packsLabel')"
      data-test="alert-starter-library-packs"
    >
      <template v-if="busy">
        <OSkeleton
          v-for="n in 4"
          :key="n"
          animation="none"
          class="rounded-default h-6 w-20"
          :aria-label="t('alertStarter.library.loading')"
        />
      </template>
      <OButton
        v-for="chip in packChips"
        v-else
        :key="chip.id"
        :variant="pack === chip.id ? 'outline-primary' : 'outline'"
        size="chip"
        :aria-pressed="pack === chip.id"
        :data-test="`alert-starter-library-pack-${chip.id}`"
        @click="pack = chip.id"
      >
        {{ chip.label }}
        <span class="text-text-secondary tabular-nums">{{ formatNumber(chip.count) }}</span>
      </OButton>
    </div>

    <div v-if="!failed" class="flex min-h-6 shrink-0 items-center justify-between gap-3 text-xs">
      <OSkeleton
        v-if="busy"
        animation="none"
        class="h-3 w-36"
        :aria-label="t('alertStarter.library.loading')"
      />
      <span
        v-else
        role="status"
        class="text-text-heading font-medium"
        data-test="alert-starter-library-total"
        >{{ totalText }}</span
      >
      <OCheckbox
        v-if="!busy && rows.length > 0"
        size="sm"
        :model-value="selectAllState"
        :label="t('alertStarter.library.selectAll', { count: rows.length }, rows.length)"
        data-test="alert-starter-library-select-all"
        @update:model-value="toggleAll"
      />
    </div>

    <OInlineNotice
      v-if="failed"
      variant="error"
      :text="t('alertStarter.library.loadFailed')"
      :action-label="t('alert_library.retry')"
      data-test="alert-starter-library-error"
      action-data-test="alert-starter-library-retry"
      @action="retry"
    />

    <div
      v-else
      class="max-h-96 min-h-48 overflow-y-auto"
      role="list"
      :aria-label="t('alertStarter.library.listLabel')"
      :aria-busy="busy"
      data-test="alert-starter-library-rows"
      @scroll.passive="markActed"
    >
      <template v-if="busy">
        <div
          v-for="n in showSkeleton ? 4 : 0"
          :key="n"
          class="flex items-start gap-2 px-2.5 py-2"
          data-test="alert-starter-library-skeleton-row"
        >
          <OSkeleton animation="none" class="rounded-default mt-0.5 size-4 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <OSkeleton animation="none" class="h-4 w-3/5" />
            <OSkeleton animation="none" class="h-3 w-4/5" />
          </div>
        </div>
      </template>
      <OEmptyState
        v-else-if="rows.length === 0"
        size="compact"
        :variant="ready.length ? 'no-results' : 'neutral'"
        :title="emptyTitle"
        :description="emptyDescription"
        :action-label="emptyAction"
        data-test="alert-starter-library-empty"
        @action="onEmptyAction"
      />
      <LibraryPaneRow
        v-for="entry in rows"
        v-else
        :key="entry.id"
        :ref="observeRow"
        :entry="entry"
        :selected="selectedSet.has(entry.id)"
        :openable="alertType === 'scheduled'"
        :summary="summaries[entry.id] ?? null"
        :summary-pending="seen.has(entry.id) && !(entry.id in files)"
        :verdict="verdictFor(entry)"
        :own="ownById[entry.id] ?? []"
        @open="openEntry(entry)"
        @update:selected="setSelected(entry.id, $event)"
        @open-existing="openExisting"
      />
    </div>

    <div
      v-if="!busy && !failed && notReadyCount > 0 && ready.length > 0"
      class="border-border-subtle text-text-secondary flex shrink-0 items-center justify-between gap-3 border-t pt-2 text-xs"
      data-test="alert-starter-library-more"
    >
      <span>{{
        t("alertStarter.library.needData", { count: formatNumber(notReadyCount) }, notReadyCount)
      }}</span>
      <OButton
        variant="ghost-primary"
        size="xs"
        icon-right="arrow-forward"
        data-test="alert-starter-library-browse"
        @click="browseAll"
      >
        {{ t("alertStarter.library.browseAll", { count: formatNumber(entries.length) }) }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useQueries } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { buildInstallPayload } from "@/components/alertLibrary/libraryInstall";
import { packLabel } from "@/components/alertLibrary/libraryFacets";
import { fileForInstall } from "@/components/alertLibrary/libraryTunables";
import type { StarterScope } from "@/components/create-starter/createStarter.types";
import { useAlertCreation } from "@/composables/alerts/useAlertCreation";
import { streamDataState, useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { queryClient } from "@/composables/query/queryClient";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { librarySuggestionsQuery } from "@/services/alert_library.queries";
import { streamSchemaQuery } from "@/services/stream.queries";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { formatNumber } from "@/utils/alerts/alertCopy";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import type { DayVerdict } from "@/utils/alerts/alertTestRun";
import type { AlreadySetUp } from "@/utils/alerts/librarySuggest.types";
import { buildPrefillFromLibrary } from "@/utils/alerts/prefill/fromLibrary";
import { entryInScope, scopePrefill, type ScopeSkipReason } from "@/utils/alerts/starterScope";

import LibraryPaneRow from "./LibraryPaneRow.vue";
import StarterScopeSelect from "./StarterScopeSelect.vue";
import {
  prefillSummary,
  SCOPE_STREAM_TYPES,
  useLibraryDryRun,
  useLibraryReadiness,
  useStarterScopeOptions,
  orderRows,
  selectAllNext,
} from "./libraryPaneData";

const props = defineProps<{
  alertType: "scheduled" | "anomaly_detection";
  selected: string[];
  /** Optional v-model, so the host can hand the same scope to bulk add. */
  scope?: StarterScope;
}>();

const emit = defineEmits<{
  (e: "opened"): void;
  (e: "update:selected", value: string[]): void;
  (e: "update:scope", value: StarterScope): void;
}>();

/** Library matches per stream: enough to cover every entry the manifest has for one stream. */
const SUGGEST_LIMIT = 50;

const SKIP_KEYS: Record<ScopeSkipReason, I18nKey> = {
  streamDiffers: "alertStarter.library.scopeSkipped.streamDiffers",
  noField: "alertStarter.library.scopeSkipped.noField",
  queryShape: "alertStarter.library.scopeSkipped.queryShape",
};

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const { loadAlertFile } = useAlertLibrary();
const { entries, ready, busy, failed, streamsByType, load } = useLibraryReadiness(
  () => props.alertType,
);
const showSkeleton = useDelayedFlag(busy);
const { openAlertCreation } = useAlertCreation();
const scopeData = useStarterScopeOptions();
const dryRun = useLibraryDryRun(org);

const search = ref("");
const localScope = ref<StarterScope>({ kind: "all" });
const scope = computed<StarterScope>({
  get: () => props.scope ?? localScope.value,
  set: (value) => {
    localScope.value = value;
    emit("update:scope", value);
  },
});
const pack = ref("all");

const notReadyCount = computed(() => entries.value.length - ready.value.length);

// ── filters ──
const scopeOption = computed(() =>
  scope.value.kind === "service" ? scopeData.optionFor(scope.value) : null,
);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const needle = computed(() => search.value.trim().toLowerCase());
const searched = computed(() =>
  ready.value.filter(
    (entry) =>
      entryInScope(entry, scope.value, scopeOption.value) &&
      (!needle.value ||
        [entry.title, entry.id, entry.description, entry.stream]
          .map(text)
          .join(" ")
          .toLowerCase()
          .includes(needle.value)),
  ),
);
const filtered = computed(() =>
  pack.value === "all" ? searched.value : searched.value.filter((e) => e.pack === pack.value),
);

/** Every pack the ready set holds stays listed in one order, so a chip never moves under the pointer. */
const packChips = computed(() => {
  const sizes = new Map<string, number>();
  for (const entry of ready.value) sizes.set(entry.pack, (sizes.get(entry.pack) ?? 0) + 1);
  const counts = new Map<string, number>();
  for (const entry of searched.value) counts.set(entry.pack, (counts.get(entry.pack) ?? 0) + 1);
  const packs = [...sizes.entries()]
    .sort((a, b) => b[1] - a[1] || String(packLabel(a[0])).localeCompare(String(packLabel(b[0]))))
    .map(([id]) => ({ id, label: packLabel(id), count: counts.get(id) ?? 0 }));
  return [
    { id: "all", label: t("alertStarter.library.packAll"), count: searched.value.length },
    ...packs,
  ];
});

const scopeName = computed(() => {
  const current = scope.value;
  if (current.kind === "stream") return current.streamName;
  if (current.kind === "service") return scopeOption.value?.label ?? current.service;
  return "";
});

const totalText = computed<I18nText>(() => {
  const count = filtered.value.length;
  const total = ready.value.length;
  if (needle.value) {
    return t("alertStarter.library.matchOfSearch", {
      count,
      total,
      query: raw(search.value.trim()),
    });
  }
  if (scope.value.kind !== "all") {
    return t("alertStarter.library.matchOfScope", { count, total, name: raw(scopeName.value) });
  }
  if (pack.value !== "all") {
    return t("alertStarter.library.matchOfPack", { count, total, pack: packLabel(pack.value) });
  }
  return t("createStarter.matchCount", { count: total }, total);
});

// ── order: what you already have sinks, but never under a pointer already at work ──
let acted = false;
const markActed = () => {
  acted = true;
};

// ── rows in view ──
const seen = shallowRef<Set<string>>(new Set());
const markSeen = (ids: string[]) => {
  const fresh = ids.filter((id) => id && !seen.value.has(id));
  if (fresh.length) seen.value = new Set([...seen.value, ...fresh]);
};
const observer =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((records) =>
        markSeen(
          records
            .filter((record) => record.isIntersecting)
            .map((record) => (record.target as HTMLElement).dataset.entryId ?? ""),
        ),
      );
const observeRow = (instance: unknown) => {
  const el = (instance as { $el?: HTMLElement } | null)?.$el;
  if (!el?.dataset) return;
  if (observer) observer.observe(el);
  else markSeen([el.dataset.entryId ?? ""]);
};
onBeforeUnmount(() => observer?.disconnect());

const seenEntries = computed(() => ready.value.filter((entry) => seen.value.has(entry.id)));

// "You have N like this": one suggestions read per stream of a row in view.
const suggestStreams = computed(() => {
  const keys = new Map<string, { type: (typeof SCOPE_STREAM_TYPES)[number]; name: string }>();
  for (const entry of seenEntries.value) {
    const type = SCOPE_STREAM_TYPES.find((one) => one === entry.stream_type);
    if (type && entry.stream) keys.set(`${type}/${entry.stream}`, { type, name: entry.stream });
  }
  return [...keys.values()];
});
const suggestions = useQueries({
  queries: computed(() =>
    suggestStreams.value.map(({ type, name }) => ({
      ...librarySuggestionsQuery(org.value, {
        stream_type: type,
        stream_name: name,
        alert_type: props.alertType,
        limit: SUGGEST_LIMIT,
      }),
      enabled: !!org.value,
    })),
  ),
});
const ownById = computed<Record<string, AlreadySetUp[]>>(() => {
  const own: Record<string, AlreadySetUp[]> = {};
  for (const query of suggestions.value) {
    for (const suggestion of query.data?.suggestions ?? []) {
      if (suggestion.kind === "library" && suggestion.already_set_up?.length) {
        own[suggestion.id] = suggestion.already_set_up;
      }
    }
  }
  return own;
});

const order = shallowRef<string[]>([]);
const resort = () => {
  order.value = orderRows(filtered.value, ownById.value);
};
watch(
  () => filtered.value.map((entry) => entry.id).join("\n"),
  () => {
    acted = false;
    resort();
  },
  { immediate: true },
);
watch(ownById, () => {
  if (!acted) resort();
});
const rows = computed(() => {
  const byId = new Map(filtered.value.map((entry) => [entry.id, entry]));
  const placed = order.value.filter((id) => byId.has(id));
  const rest = filtered.value.filter((entry) => !order.value.includes(entry.id));
  return [...placed.map((id) => byId.get(id)!), ...rest];
});
// Detail and dry runs are asked in the order the rows show, so the top of the list answers first.
const seenRows = computed(() => rows.value.filter((entry) => seen.value.has(entry.id)));

// ── per-row detail: the alert file, then what it groups by and fires on ──
// Absent while loading; null once it failed, so a failure stops the skeleton.
const files = shallowRef<Record<string, AlertLibraryFile | null>>({});
const requestedFiles = new Set<string>();
const keepFile = (id: string, file: AlertLibraryFile | null) => {
  files.value = { ...files.value, [id]: file };
};
watch(seenRows, (list) => {
  for (const entry of list) {
    if (requestedFiles.has(entry.id)) continue;
    requestedFiles.add(entry.id);
    void loadAlertFile(entry)
      .then((file) => keepFile(entry.id, file))
      .catch(() => keepFile(entry.id, null));
  }
});
const summaries = computed(() => {
  const out: Record<string, { per: string[]; condition: string }> = {};
  for (const entry of seenEntries.value) {
    const file = files.value[entry.id];
    if (!file || entry.alert_type === "anomaly_detection") continue;
    out[entry.id] = prefillSummary(
      buildPrefillFromLibrary({ entry, file: fileForInstall(entry, file) }),
    );
  }
  return out;
});

// ── would-have-fired: a dry run per row in view ──
const dryRunKey = (entry: AlertLibraryEntry) =>
  `${entry.id}@${entry.content_hash}|${entry.stream_type}/${entry.stream}`;
const canDryRun = (entry: AlertLibraryEntry) =>
  props.alertType === "scheduled" &&
  ["fresh", "stale"].includes(streamDataState(entry, streamsByType.value).state);

const evaluateBody = async (entry: AlertLibraryEntry): Promise<EvaluateAlertBody | null> => {
  const file = await loadAlertFile(entry);
  return buildInstallPayload({
    entry,
    file: fileForInstall(entry, file),
    folderId: "default",
    owner: store.state.userInfo?.email ?? "",
    timezone: store.state.timezone,
  }) as unknown as EvaluateAlertBody;
};
watch(seenRows, (list) => {
  for (const entry of list) {
    if (canDryRun(entry) && !ownById.value[entry.id]) {
      dryRun.request(dryRunKey(entry), () => evaluateBody(entry));
    }
  }
});
// A row is pending only once it has been in view and asked; others say nothing yet.
const verdictFor = (entry: AlertLibraryEntry): DayVerdict | "pending" | null =>
  canDryRun(entry) && seen.value.has(entry.id)
    ? (dryRun.verdicts.value[dryRunKey(entry)] ?? "pending")
    : null;

// ── selection ──
const selectedSet = computed(() => new Set(props.selected));
const setSelected = (id: string, on: boolean) => {
  const next = new Set(props.selected);
  if (on) next.add(id);
  else next.delete(id);
  emit("update:selected", [...next]);
};
const selectAllState = computed<boolean | "indeterminate">(() => {
  const ticked = rows.value.filter((entry) => selectedSet.value.has(entry.id)).length;
  if (ticked === 0) return false;
  return ticked === rows.value.length ? true : "indeterminate";
});
const toggleAll = () => {
  emit(
    "update:selected",
    selectAllNext(
      props.selected,
      rows.value.map((entry) => entry.id),
    ),
  );
};

// ── empty and failure ──
const filtersOn = computed(
  () => !!needle.value || scope.value.kind !== "all" || pack.value !== "all",
);
const emptyTitle = computed(() =>
  ready.value.length
    ? t("alertStarter.library.emptyFilteredTitle")
    : t("alertStarter.library.emptyNoneTitle", { total: formatNumber(entries.value.length) }),
);
const emptyDescription = computed(() =>
  ready.value.length
    ? t(
        "alertStarter.library.emptyFilteredDescription",
        { count: ready.value.length },
        ready.value.length,
      )
    : t("alertStarter.library.emptyNoneDescription"),
);
const emptyAction = computed(() =>
  ready.value.length && filtersOn.value
    ? t("alertStarter.library.clearFilters")
    : entries.value.length
      ? t("alertStarter.library.browseAll", { count: formatNumber(entries.value.length) })
      : undefined,
);
const onEmptyAction = () => {
  if (ready.value.length && filtersOn.value) {
    search.value = "";
    scope.value = { kind: "all" };
    pack.value = "all";
    return;
  }
  browseAll();
};

const retry = () => load(true);

const browseAll = () => {
  void router.push({ name: "alertLibrary", query: { org_identifier: org.value } });
  emit("opened");
};

const openExisting = (alertId: string) => {
  void router.push({
    name: "editAlert",
    params: { alert_id: alertId },
    query: { org_identifier: org.value },
  });
  emit("opened");
};

// ── open one row in the form, as Customize in editor does, narrowed to the scope ──
const schemaFields = async (name: string, type: string): Promise<Set<string> | undefined> => {
  try {
    const payload = await queryClient.fetchQuery(streamSchemaQuery(org.value, name, type));
    const columns: Array<{ name?: unknown }> = payload?.schema ?? payload?.uds_schema ?? [];
    const names = columns.map((c) => c?.name).filter((n): n is string => typeof n === "string");
    return names.length ? new Set(names) : undefined;
  } catch {
    return undefined;
  }
};

let opening = false;
const openEntry = async (entry: AlertLibraryEntry) => {
  if (opening) return;
  opening = true;
  try {
    const file = await loadAlertFile(entry).catch(() => null);
    if (!file || file.alert_type === "anomaly_detection") throw new Error("not prefillable");
    let prefill = buildPrefillFromLibrary({ entry, file: fileForInstall(entry, file) });
    let reason: ScopeSkipReason | null = null;
    if (scope.value.kind !== "all") {
      const fields = await schemaFields(prefill.streamName, prefill.streamType);
      ({ prefill, reason } = scopePrefill(prefill, scope.value, {
        fields,
        groups: scopeData.groups.value,
      }));
    }
    if (!openAlertCreation(prefill)) throw new Error("not opened");
    if (reason) {
      toast({ variant: "info", message: t(SKIP_KEYS[reason], { name: raw(scopeName.value) }) });
    }
    emit("opened");
  } catch {
    toast({ variant: "error", message: t("alert_library.drawer.customizeFailed") });
  } finally {
    opening = false;
  }
};

const entriesById = (ids: string[]): AlertLibraryEntry[] => {
  const wanted = new Set(ids);
  return entries.value.filter((entry) => wanted.has(entry.id));
};

defineExpose({ entriesById });

onMounted(() => load());
</script>
