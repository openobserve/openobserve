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

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4"
    data-test="svcver-name-review"
  >
    <div class="px-page-edge">
      <InfoNotice data-test="svcver-name-review-banner">{{
        t("serviceVersions.nameReview.banner")
      }}</InfoNotice>
    </div>
    <div class="px-page-edge flex flex-wrap items-center gap-2">
      <OToggleGroup
        :model-value="filter"
        :aria-label="t('serviceVersions.nameReview.filters.label')"
        data-test="svcver-name-review-filters"
        @update:model-value="setFilter"
      >
        <OToggleGroupItem
          v-for="item in FILTERS"
          :key="item"
          :value="item"
          size="sm"
          :data-test="`svcver-name-review-filter-${item}`"
          >{{ t(`serviceVersions.nameReview.filters.${item}`) }}
          <span class="text-text-secondary ms-1.5 text-xs tabular-nums">{{
            raw(counts[item] ?? "–")
          }}</span></OToggleGroupItem
        >
      </OToggleGroup>
      <span
        v-if="readOnly"
        class="text-text-secondary text-xs"
        data-test="svcver-name-review-readonly"
        >{{ t("serviceVersions.nameReview.states.readOnly") }}</span
      >
      <OButton
        v-if="!readOnly"
        class="ms-auto"
        variant="outline"
        size="xs"
        :disabled="acceptHigh.done || !highTotal || busy !== ''"
        :loading="busy === BULK"
        data-test="svcver-name-review-accept-high"
        @click="acceptHighConfidence"
        >{{
          acceptHigh.done
            ? t("serviceVersions.nameReview.acceptHighDone", { n: acceptHigh.count })
            : highTotal
              ? t("serviceVersions.nameReview.acceptHigh", { n: highTotal })
              : t("serviceVersions.nameReview.noHighConfidence")
        }}</OButton
      >
    </div>
    <div v-if="actionError" class="px-page-edge">
      <OBanner
        variant="error"
        icon="error-outline"
        dense
        data-test="svcver-name-review-action-error"
        >{{ actionError }}</OBanner
      >
    </div>
    <div v-if="skipped" class="px-page-edge">
      <OBanner variant="warning" icon="warning" dense data-test="svcver-name-review-skipped">{{
        t("serviceVersions.nameReview.collision.skipped", { n: skipped }, skipped)
      }}</OBanner>
    </div>

    <div
      v-if="list.isPending.value"
      class="px-page-edge flex flex-col gap-2"
      data-test="svcver-name-review-loading"
    >
      <OSkeleton class="h-10 w-full" />
      <OSkeleton class="h-40 w-full" />
    </div>
    <OEmptyState
      v-else-if="denied"
      size="hero"
      preset="no-access"
      :description="t('serviceVersions.nameReview.states.denied')"
      data-test="svcver-name-review-denied"
    />
    <div
      v-else-if="list.isError.value"
      class="mx-page-edge rounded-default border-border-default text-text-secondary flex items-center gap-2 border px-4 py-3 text-sm"
      data-test="svcver-name-review-error"
    >
      <OIcon name="error-outline" size="sm" class="text-status-error-text" />
      <span>{{ loadError }}</span>
      <OButton variant="ghost-primary" size="xs" @click="list.refetch()">{{
        t("serviceVersions.actions.retry")
      }}</OButton>
    </div>
    <OEmptyState
      v-else-if="!rows.length && page === 1"
      size="compact"
      preset="no-data"
      :title="t(`serviceVersions.nameReview.states.${EMPTY[filter]}`)"
      :description="t('serviceVersions.nameReview.states.emptyBody')"
      data-test="svcver-name-review-empty"
    />
    <div v-else class="px-page-edge">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="alias_key"
        pagination="server"
        :total-count="total"
        :page-size="PAGE_SIZE"
        :current-page="page"
        expansion="multiple"
        :expanded-ids="expandedIds"
        :get-row-expansion-enabled="() => false"
        :default-columns="false"
        :show-global-filter="false"
        class="o2-table o2-row-md w-full"
        data-test="svcver-name-review-table"
        @pagination-change="({ page: next }: { page: number }) => (page = next)"
      >
        <template #cell-display="{ row }"
          ><b class="text-text-heading" :data-test="`svcver-alias-row-${row.alias_key}`">{{
            row.canonical
          }}</b></template
        >
        <template #cell-detected="{ row }"
          ><div class="flex min-w-0 flex-col">
            <OTruncatedText class="font-mono text-xs">{{ row.alias }}</OTruncatedText>
            <span v-if="row.scope" class="text-text-secondary text-xs">{{ raw(row.scope) }}</span>
          </div></template
        >
        <template #cell-evidence="{ row }"
          ><span class="text-sm">{{ evidenceText(row) }}</span></template
        >
        <template #cell-env="{ row }"
          ><div class="flex flex-col gap-1">
            <span class="flex flex-wrap gap-1"
              ><ServiceEnvChip
                v-for="scope in envScopes(row)"
                :key="scope.scope_key"
                :identity="scope"
                :service="scope.service"
                readonly
            /></span>
            <span
              v-if="separateEnvs(row).length > 1"
              class="text-text-secondary text-xs"
              :data-test="`svcver-alias-env-stays-${row.alias_key}`"
              >{{
                t("serviceVersions.nameReview.envStays", { envs: listFormat(separateEnvs(row)) })
              }}</span
            >
          </div></template
        >
        <template #cell-confidence="{ row }"
          ><OTag type="aliasConfidence" :value="row.confidence"
        /></template>
        <template #cell-actions="{ row }"
          ><div v-if="!readOnly" class="flex items-center justify-end gap-1">
            <template v-if="filter !== 'accepted'">
              <OButton
                variant="outline"
                size="xs"
                icon-left="check"
                :loading="busy === row.alias_key"
                :disabled="busy !== '' && busy !== row.alias_key"
                :data-test="`svcver-alias-accept-${row.alias_key}`"
                @click="accept(row)"
                >{{ t("serviceVersions.nameReview.accept") }}</OButton
              >
              <OButton
                variant="ghost"
                size="xs"
                icon-left="edit"
                :aria-label="t('serviceVersions.nameReview.edit')"
                :disabled="busy !== ''"
                :data-test="`svcver-alias-edit-${row.alias_key}`"
                @click="openEditor(row)"
              />
              <OButton
                v-if="filter === 'pending'"
                variant="ghost-destructive"
                size="xs"
                :disabled="busy !== ''"
                :data-test="`svcver-alias-reject-${row.alias_key}`"
                @click="reject(row)"
                >{{ t("serviceVersions.nameReview.reject") }}</OButton
              >
            </template>
            <OButton
              v-else
              variant="outline"
              size="xs"
              icon-left="undo"
              :loading="busy === row.alias_key"
              :disabled="busy !== '' && busy !== row.alias_key"
              :data-test="`svcver-alias-revert-${row.alias_key}`"
              @click="reject(row)"
              >{{ t("serviceVersions.nameReview.revert") }}</OButton
            >
          </div></template
        >
        <template #expansion="{ row }">
          <NameReviewEditor
            v-if="editors[row.alias_key]"
            :state="editors[row.alias_key]"
            :suggestions="traceNames"
            :busy="busy === row.alias_key"
            @update:value="(value: string) => (editors[row.alias_key].value = value)"
            @submit="(value: string) => saveDisplay(row, value, false)"
            @use-qualified="saveDisplay(row, editors[row.alias_key].value, true)"
            @keep="reject(row)"
            @cancel="closeEditor(row.alias_key)"
          />
        </template>
      </OTable>
    </div>

    <template v-if="!denied && unresolvedRows.length">
      <div class="px-page-edge flex items-center gap-2 pt-2" data-test="svcver-unresolved">
        <span class="text-text-heading text-sm font-semibold">{{
          t("serviceVersions.nameReview.unresolved.title")
        }}</span>
        <OTag type="countChip" value="neutral" data-test="svcver-unresolved-count">{{
          raw(unresolvedRows.length)
        }}</OTag>
        <span class="text-text-secondary text-xs" data-test="svcver-unresolved-sub">{{
          t("serviceVersions.nameReview.unresolved.sub")
        }}</span>
        <span
          v-if="podsSentence"
          class="text-text-secondary text-xs"
          data-test="svcver-unresolved-pods"
          >{{ t("serviceVersions.nameReview.unresolved.noTrace") }}</span
        >
      </div>
      <div class="px-page-edge">
        <OTable
          :data="unresolvedRows"
          :columns="unresolvedColumns"
          row-key="slug"
          pagination="none"
          expansion="multiple"
          :expanded-ids="unresolvedExpanded"
          :get-row-expansion-enabled="() => false"
          :default-columns="false"
          :show-global-filter="false"
          wrap
          class="o2-table o2-row-sm w-full"
          data-test="svcver-unresolved-table"
        >
          <template #cell-name="{ row }"
            ><span class="font-mono text-sm" :data-test="`svcver-unresolved-${row.slug}`">{{
              row.name || raw('""')
            }}</span></template
          >
          <template #cell-seen="{ row }"
            ><span class="flex flex-wrap gap-1"
              ><OTag
                v-for="signal in row.signals"
                :key="signal"
                type="streamType"
                :value="signal"
                >{{ t(`settings.correlation.${signal}`) }}</OTag
              ></span
            ></template
          >
          <template #cell-why="{ row }"
            ><span class="text-sm"
              >{{ whyText(row)
              }}<OTooltip
                v-if="row.candidates.length"
                :content="raw(row.candidates.join(', '))"
                content-class="text-xs" /></span
          ></template>
          <template #cell-action="{ row }"
            ><OButton
              v-if="!readOnly && !row.candidates.length && row.name && !internalName(row.name)"
              variant="ghost-primary"
              size="xs"
              :data-test="`svcver-unresolved-display-as-${row.slug}`"
              @click="openUnresolved(row)"
              >{{ t("serviceVersions.nameReview.unresolved.displayAs") }}</OButton
            ></template
          >
          <template #expansion="{ row }">
            <NameReviewEditor
              v-if="editors[unresolvedId(row)]"
              :state="editors[unresolvedId(row)]"
              :suggestions="traceNames"
              :busy="busy === unresolvedId(row)"
              @update:value="(value: string) => (editors[unresolvedId(row)].value = value)"
              @submit="(value: string) => createDisplay(row, value, false)"
              @use-qualified="createDisplay(row, editors[unresolvedId(row)].value, true)"
              @keep="closeEditor(unresolvedId(row))"
              @cancel="closeEditor(unresolvedId(row))"
            />
          </template>
        </OTable>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="undo"
        class="rounded-default shadow-toast bg-toast-default-bg border-toast-default-border text-toast-fg pointer-events-auto fixed bottom-6 left-1/2 z-10001 flex -translate-x-1/2 items-center gap-3 border px-4 py-2.5 text-sm whitespace-nowrap"
        role="status"
        data-test="svcver-name-review-undo"
      >
        <span>{{ undo.error || undo.message }}</span>
        <OButton
          v-if="undo.batchId && !undo.error"
          variant="ghost-primary"
          size="xs"
          :loading="undo.busy"
          data-test="svcver-name-review-undo-action"
          @click="runUndo"
          >{{ t("serviceVersions.nameReview.snack.undo") }}</OButton
        >
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, h, type PropType } from "vue";
import { Translation } from "vue-i18n";
import type { Alias, AliasCollisionError, Collision, Scope } from "@/services/service_versions";
import { placeholderLineKey, type DisplaySource } from "@/types/serviceRef";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";

export type NameReviewFilter = "pending" | "accepted" | "rejected";
export interface EditorState {
  value: string;
  collision: Collision | null;
}
export interface DiscoveredRow {
  service_name: string;
  display_source?: DisplaySource;
  display_candidates?: string[];
  all_dimensions?: Record<string, string>;
  disambiguation?: Record<string, string>;
  logs_streams: string[];
  traces_streams: string[];
  metrics_streams: string[];
}
export interface UnresolvedRow {
  slug: string;
  name: string;
  signals: ("logs" | "traces" | "metrics")[];
  candidates: string[];
  placeholder: boolean;
  pods: boolean;
}

export const FILTER_STATUS: Record<NameReviewFilter, "proposed" | "accepted" | "rejected"> = {
  pending: "proposed",
  accepted: "accepted",
  rejected: "rejected",
};

export function slugOf(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "name"
  );
}

// The 409 body is the only place a collision is described; anything else is a plain failure.
export function collisionOf(error: unknown): Collision | null {
  const data = (error as { response?: { status?: number; data?: AliasCollisionError } })?.response;
  if (data?.status !== 409 || data.data?.error !== "alias_collision") return null;
  return data.data.collisions?.[0] ?? null;
}

// A k8s_workload alias lives in one namespace, so only that namespace's scopes describe its env.
export function aliasScopes(alias: Alias, scopes: Scope[]) {
  const named = scopes.filter((scope) => scope.service === alias.canonical);
  if (alias.kind !== "k8s_workload") return named;
  return named.filter((scope) => scope.where?.k8s_namespace === alias.scope);
}

// One inline editor serves alias rows and Unresolved rows; a 409 swaps its buttons for the collision choices.
export const NameReviewEditor = defineComponent({
  name: "NameReviewEditor",
  props: {
    state: { type: Object as PropType<EditorState>, required: true },
    suggestions: { type: Array as PropType<string[]>, default: () => [] },
    busy: { type: Boolean, default: false },
  },
  emits: ["update:value", "submit", "use-qualified", "keep", "cancel"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const items = computed(() =>
      props.suggestions.map((name) => ({ label: raw(name), value: name })),
    );
    const submit = (value = props.state.value) => {
      if (value.trim()) emit("submit", value.trim());
    };
    const collisionView = (collision: Collision) => {
      const existing = collision.existing[0];
      const where = existing?.env || existing?.scope || "";
      const qualifier = collision.suggested_qualifier;
      return [
        h(
          OBanner,
          {
            variant: "warning",
            icon: "warning",
            dense: true,
            "data-test": "svcver-alias-collision",
          },
          () =>
            h(
              Translation,
              {
                keypath: !existing
                  ? "serviceVersions.nameReview.collision.messageNoExisting"
                  : where
                    ? "serviceVersions.nameReview.collision.message"
                    : "serviceVersions.nameReview.collision.messageNoWhere",
                tag: "span",
              },
              {
                name: () => h("b", collision.display_name),
                existing: () => h("span", { class: "font-mono" }, existing?.service_key ?? ""),
                where: () => where,
                plain: () => collision.display_name,
              },
            ),
        ),
        h("div", { class: "flex flex-wrap gap-2" }, [
          qualifier
            ? h(
                OButton,
                {
                  variant: "primary",
                  size: "sm",
                  loading: props.busy,
                  "data-test": "svcver-alias-collision-qualified",
                  onClick: () => emit("use-qualified"),
                },
                () =>
                  t("serviceVersions.nameReview.collision.useQualified", {
                    name: collision.display_name,
                    qualifier,
                  }),
              )
            : null,
          h(
            OButton,
            {
              variant: "ghost",
              size: "sm",
              disabled: props.busy,
              "data-test": "svcver-alias-collision-keep",
              onClick: () => emit("keep"),
            },
            () => t("serviceVersions.nameReview.collision.keep"),
          ),
        ]),
      ];
    };
    const actions = () =>
      h("div", { class: "flex gap-2" }, [
        h(
          OButton,
          {
            variant: "primary",
            size: "sm",
            loading: props.busy,
            disabled: !props.state.value.trim(),
            "data-test": "svcver-alias-display-as-save",
            onClick: () => submit(),
          },
          () => t("serviceVersions.nameReview.editor.save"),
        ),
        h(
          OButton,
          {
            variant: "ghost",
            size: "sm",
            disabled: props.busy,
            "data-test": "svcver-alias-display-as-cancel",
            onClick: () => emit("cancel"),
          },
          () => t("serviceVersions.nameReview.editor.cancel"),
        ),
      ]);
    return () =>
      h(
        "div",
        { class: "flex flex-wrap gap-4 px-4 py-3", "data-test": "svcver-name-review-inline-edit" },
        [
          h(
            "div",
            {
              class: "flex w-80 flex-col",
              onKeydown: (event: KeyboardEvent) => event.key === "Enter" && submit(),
            },
            h(OCombobox, {
              modelValue: props.state.value,
              label: t("serviceVersions.nameReview.editor.label"),
              helpText: t("serviceVersions.nameReview.editor.hint"),
              items: items.value,
              size: "sm",
              "data-test": "svcver-alias-display-as-input",
              "onUpdate:modelValue": (value: string) => emit("update:value", value),
              onSelect: (value: string) => {
                emit("update:value", value);
                submit(value);
              },
            }),
          ),
          h(
            "div",
            { class: "flex min-w-0 flex-1 flex-col gap-2" },
            props.state.collision ? collisionView(props.state.collision) : actions(),
          ),
        ],
      );
  },
});

// Detection-only keys and SDK placeholder names have no trace name; ambiguous keys list their candidates.
export function unresolvedFrom(rows: DiscoveredRow[], placeholders: string[]): UnresolvedRow[] {
  const byName = new Map<string, UnresolvedRow>();
  for (const row of rows) {
    if (row.display_source !== "detection" && row.display_source !== "detection_ambiguous")
      continue;
    const entry = byName.get(row.service_name) ?? {
      slug: slugOf(row.service_name),
      name: row.service_name,
      signals: [],
      candidates: [],
      placeholder: false,
      pods: false,
    };
    entry.pods ||= Object.keys({ ...row.disambiguation, ...row.all_dimensions }).some((key) =>
      key.startsWith("k8s-"),
    );
    const signals = new Set(entry.signals);
    if (row.logs_streams.length) signals.add("logs");
    if (row.traces_streams.length) signals.add("traces");
    if (row.metrics_streams.length) signals.add("metrics");
    entry.signals = (["logs", "traces", "metrics"] as const).filter((s) => signals.has(s));
    if (row.display_source === "detection_ambiguous")
      entry.candidates = [
        ...new Set([...entry.candidates, ...(row.display_candidates || [])]),
      ].sort();
    byName.set(row.service_name, entry);
  }
  for (const name of placeholders)
    if (!byName.has(name))
      byName.set(name, {
        slug: slugOf(name),
        name,
        signals: ["traces"],
        candidates: [],
        placeholder: true,
        pods: false,
      });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { isAxiosError } from "axios";
import {
  aliasesQuery,
  bulkAliasesMutation,
  createAliasMutation,
  identityQuery,
  undoAliasesMutation,
  updateAliasMutation,
} from "@/services/service_versions.queries";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import InfoNotice from "@/components/shared/InfoNotice.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";

const props = defineProps<{
  services: DiscoveredRow[];
  scopes: Scope[];
  traceNames: string[];
  canEdit: boolean;
}>();
const emit = defineEmits<{ (e: "changed"): void }>();

const PAGE_SIZE = 50;
const UNDO_MS = 10_000;
const BULK = "__bulk__";
const FILTERS: NameReviewFilter[] = ["pending", "accepted", "rejected"];
const EMPTY = {
  pending: "emptyPending",
  accepted: "emptyAccepted",
  rejected: "emptyRejected",
} as const;

const { t, locale } = useI18nTyped();
const store = useStore();
const org = computed(() => String(store.state.selectedOrganization?.identifier || ""));
const user = computed(() => String(store.state.userInfo?.email || ""));
const filter = ref<NameReviewFilter>("pending");
const page = ref(1);
const busy = ref("");
const actionError = ref("");
const writeDenied = ref(false);
const skipped = ref(0);
const editors = reactive<Record<string, EditorState>>({});
const acceptHigh = reactive({ done: false, count: 0 });
const undo = ref<{
  message: string;
  batchId: string;
  busy: boolean;
  error: string;
} | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

const read = (params: Record<string, string | number>) =>
  useQuery(
    computed(() => ({
      ...aliasesQuery(org.value, user.value, params),
      enabled: Boolean(org.value),
    })),
  );
const list = useQuery(
  computed(() => ({
    ...aliasesQuery(org.value, user.value, {
      status: FILTER_STATUS[filter.value],
      limit: PAGE_SIZE,
      offset: (page.value - 1) * PAGE_SIZE,
    }),
    enabled: Boolean(org.value),
  })),
);
const pendingCount = read({ status: "proposed", limit: 1 });
const acceptedCount = read({ status: "accepted", limit: 1 });
const rejectedCount = read({ status: "rejected", limit: 1 });
const highCount = read({ status: "proposed", confidence: "high", limit: 1 });
const unresolved = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityUnresolved"),
    enabled: Boolean(org.value),
  })),
);
const update = useMutation(() => updateAliasMutation(org.value));
const create = useMutation(() => createAliasMutation(org.value));
const bulk = useMutation(() => bulkAliasesMutation(org.value));
const undoBatch = useMutation(() => undoAliasesMutation(org.value));

const rows = computed(() => list.data.value?.aliases || []);
const total = computed(() => list.data.value?.total || 0);
const counts = computed<Record<NameReviewFilter, number | undefined>>(() => ({
  pending: pendingCount.data.value?.total,
  accepted: acceptedCount.data.value?.total,
  rejected: rejectedCount.data.value?.total,
}));
const highTotal = computed(() => highCount.data.value?.total || 0);
const denied = computed(
  () => isAxiosError(list.error.value) && list.error.value.response?.status === 403,
);
const readOnly = computed(() => !props.canEdit || writeDenied.value || denied.value);
const loadError = computed(() =>
  isAxiosError(list.error.value) && list.error.value.response?.status === 503
    ? t("serviceVersions.nameReview.states.unavailable")
    : t("serviceVersions.nameReview.states.loadError"),
);
const expandedIds = computed(() =>
  rows.value.map((row) => row.alias_key).filter((key) => editors[key]),
);
const unresolvedRows = computed(() =>
  unresolvedFrom(
    props.services,
    (unresolved.data.value?.placeholder_names || []).map((row) => row.service),
  ),
);
// The pods sentence is said once for the group, and only when it is true of every row it covers.
const podsSentence = computed(() => {
  const plain = unresolvedRows.value.filter((row) => !row.candidates.length && !row.placeholder);
  return plain.length > 0 && plain.every((row) => row.pods);
});
const unresolvedExpanded = computed(() =>
  unresolvedRows.value.map((row) => row.slug).filter((slug) => editors[`unresolved:${slug}`]),
);
const columns = computed<OTableColumnDef<Alias>[]>(() => [
  { id: "display", header: t("serviceVersions.nameReview.cols.display"), size: 200 },
  { id: "detected", header: t("serviceVersions.nameReview.cols.detected"), size: 260 },
  { id: "evidence", header: t("serviceVersions.nameReview.cols.evidence"), size: 200 },
  {
    id: "env",
    header: t("serviceVersions.nameReview.cols.env"),
    minSize: 180,
    meta: { flex: true },
  },
  { id: "confidence", header: t("serviceVersions.nameReview.cols.confidence"), size: 100 },
  { id: "actions", header: raw(""), size: 220 },
]);
const unresolvedColumns = computed<OTableColumnDef<UnresolvedRow>[]>(() => [
  { id: "name", header: t("serviceVersions.nameReview.unresolved.cols.name"), size: 200 },
  { id: "seen", header: t("serviceVersions.nameReview.unresolved.cols.seenIn"), size: 200 },
  {
    id: "why",
    header: t("serviceVersions.nameReview.unresolved.cols.why"),
    minSize: 320,
    meta: { flex: true },
  },
  { id: "action", header: raw(""), size: 160 },
]);

watch(filter, () => {
  page.value = 1;
});
onBeforeUnmount(() => clearTimeout(undoTimer));

function setFilter(value: unknown) {
  if (FILTERS.includes(value as NameReviewFilter)) filter.value = value as NameReviewFilter;
}

function listFormat(values: string[]) {
  return new Intl.ListFormat(String(locale.value || "en"), { type: "conjunction" }).format(values);
}

function envScopes(row: Alias) {
  return aliasScopes(row, props.scopes);
}

// A display name already used in other envs keeps each workload's env.
function separateEnvs(row: Alias) {
  const envs = new Set(
    props.scopes.filter((scope) => scope.service === row.canonical).map((scope) => scope.env),
  );
  return [...envs].sort();
}

function evidenceText(row: Alias) {
  const evidence = row.evidence || {};
  const pods = Array.isArray(evidence.pods) ? evidence.pods.length : 0;
  const services = Array.isArray(evidence.services) ? evidence.services.length : 0;
  if (row.kind === "rename" && typeof evidence.from === "string")
    return t("serviceVersions.nameReview.evidence.renamed", { from: evidence.from });
  if (pods && row.confidence === "medium")
    return t("serviceVersions.nameReview.evidence.podsShared", { n: pods, total: pods });
  if (pods && services)
    return t("serviceVersions.nameReview.evidence.podsSplit", { n: pods, k: services });
  return raw("—");
}

function whyText(row: UnresolvedRow) {
  if (row.candidates.length) {
    const shown = row.candidates.slice(0, 3).join(", ");
    return t("serviceVersions.nameReview.unresolved.ambiguous", {
      n: row.candidates.length,
      names: row.candidates.length > 3 ? `${shown}…` : shown,
    });
  }
  if (!row.placeholder) return raw("");
  return t(placeholderLineKey(row.name) ?? "serviceVersions.names.placeholder");
}

// Underscore names are the app's own streams, never a service someone could rename.
function internalName(name: string) {
  return name.startsWith("_");
}

function unresolvedId(row: UnresolvedRow) {
  return `unresolved:${row.slug}`;
}

// One inline editor at a time, so a half-typed name never sits open under another row.
function openOnly(id: string, state: EditorState) {
  for (const key of Object.keys(editors)) if (key !== id) delete editors[key];
  editors[id] = state;
}

function openEditor(row: Alias, collision: Collision | null = null) {
  openOnly(row.alias_key, { value: row.canonical, collision });
}

function openUnresolved(row: UnresolvedRow) {
  openOnly(unresolvedId(row), { value: "", collision: null });
}

function closeEditor(id: string) {
  delete editors[id];
}

function failed(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 403) {
    writeDenied.value = true;
    actionError.value = t("serviceVersions.nameReview.states.readOnly");
    return;
  }
  actionError.value = t("serviceVersions.nameReview.states.writeFailed");
}

async function run(id: string, write: () => Promise<unknown>, onCollision: (c: Collision) => void) {
  if (busy.value) return false;
  busy.value = id;
  actionError.value = "";
  try {
    await write();
    emit("changed");
    return true;
  } catch (error) {
    const collision = collisionOf(error);
    if (collision) onCollision(collision);
    else failed(error);
    return false;
  } finally {
    busy.value = "";
  }
}

async function accept(row: Alias) {
  const done = await run(
    row.alias_key,
    () => update.mutateAsync({ aliasKey: row.alias_key, body: { status: "active" } }),
    (collision) => openEditor(row, collision),
  );
  if (done) closeEditor(row.alias_key);
}

async function reject(row: Alias) {
  const done = await run(
    row.alias_key,
    () => update.mutateAsync({ aliasKey: row.alias_key, body: { status: "rejected" } }),
    () => undefined,
  );
  if (done) closeEditor(row.alias_key);
}

async function saveDisplay(row: Alias, value: string, allowCollisions: boolean) {
  const canonical = value.trim();
  if (!canonical) return;
  editors[row.alias_key] = {
    value: canonical,
    collision: editors[row.alias_key]?.collision ?? null,
  };
  const body = {
    status: "active" as const,
    ...(canonical !== row.canonical ? { canonical } : {}),
    ...(allowCollisions ? { allow_collisions: true } : {}),
  };
  const done = await run(
    row.alias_key,
    () => update.mutateAsync({ aliasKey: row.alias_key, body }),
    (collision) => (editors[row.alias_key] = { value: canonical, collision }),
  );
  if (done) closeEditor(row.alias_key);
}

async function createDisplay(row: UnresolvedRow, value: string, allowCollisions: boolean) {
  const canonical = value.trim();
  const id = unresolvedId(row);
  if (!canonical) return;
  const done = await run(
    id,
    () =>
      create.mutateAsync({
        kind: "rename",
        scope: "",
        alias: row.name,
        canonical,
        ...(allowCollisions ? { allow_collisions: true } : {}),
      }),
    (collision) => (editors[id] = { value: canonical, collision }),
  );
  if (done) closeEditor(id);
}

async function acceptHighConfidence() {
  const candidates = rows.value.filter(
    (row) => filter.value === "pending" && row.confidence === "high",
  );
  let result: Awaited<ReturnType<typeof bulk.mutateAsync>> | undefined;
  const done = await run(
    BULK,
    async () => {
      result = await bulk.mutateAsync({
        action: "accept",
        alias_keys: null,
        filter: { status: "proposed", confidence: "high" },
        allow_collisions: false,
      });
    },
    () => undefined,
  );
  if (!done || !result) return;
  const collided = new Set(result.collisions.map((collision) => collision.alias_key));
  for (const collision of result.collisions) {
    const row = rows.value.find((candidate) => candidate.alias_key === collision.alias_key);
    if (row) openEditor(row, collision);
  }
  skipped.value = result.skipped_collisions;
  acceptHigh.done = true;
  acceptHigh.count = result.changed;
  const names = candidates
    .filter((row) => !collided.has(row.alias_key))
    .map((row) => row.canonical);
  showUndo(
    names.length === result.changed && names.length
      ? t(
          "serviceVersions.nameReview.snack.accepted",
          { n: result.changed, names: names.join(", ") },
          result.changed,
        )
      : t("serviceVersions.nameReview.snack.acceptedCount", { n: result.changed }, result.changed),
    result.changed ? result.batch_id : "",
  );
}

function showUndo(message: string, batchId: string) {
  clearTimeout(undoTimer);
  undo.value = { message, batchId, busy: false, error: "" };
  undoTimer = setTimeout(() => {
    undo.value = null;
  }, UNDO_MS);
}

async function runUndo() {
  const state = undo.value;
  if (!state || state.busy || !state.batchId) return;
  state.busy = true;
  try {
    const { restored } = await undoBatch.mutateAsync(state.batchId);
    emit("changed");
    acceptHigh.done = false;
    skipped.value = 0;
    showUndo(
      restored
        ? t("serviceVersions.nameReview.snack.restored", { n: restored }, restored)
        : t("serviceVersions.nameReview.snack.undoExpired"),
      "",
    );
  } catch {
    state.error = t("serviceVersions.nameReview.snack.undoFailed");
  } finally {
    state.busy = false;
  }
}
</script>
