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

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { copyToClipboard } from "@/utils/clipboard";
import K8sDrawerMetrics from "./K8sDrawerMetrics.vue";
import PodDetails from "./PodDetails.vue";
import NodeDetails from "./NodeDetails.vue";
import WorkloadDetails from "./WorkloadDetails.vue";
import { KIND_INFO } from "./kubernetesQueries";
import { detailKindOf, type EventRow } from "./kubernetesEvents";
import { labelsOf } from "./kubernetesObjects";
import { encodeDetails, type DetailsRef, type K8sUrlState } from "./kubernetesUrlState";
import {
  chipLabel,
  formatAge,
  membersOf,
  severityOf,
  toneOf,
  warningLabel,
  type AnyRow,
  type Inventory,
  type Owner,
  type Tone,
} from "./kubernetesModel";
import { TONE_PILL } from "./k8sTone";
import { worstPod } from "./workloadProblems";
import type { K8sAction } from "./k8sActions";

const props = defineProps<{
  details: DetailsRef;
  row: AnyRow | null;
  inventory: Inventory;
  pending: boolean;
  observed: boolean;
  hasEvents: boolean;
  eventsFailed: boolean;
  eventsScoped: boolean;
  events: EventRow[] | null;
  range: { start: number; end: number };
  refreshNonce: number;
  orgId: string;
  hasStream: (stream: string) => boolean;
  anchor: string;
}>();

const emit = defineEmits<{
  close: [];
  open: [ref: DetailsRef];
  action: [type: K8sAction, ref: DetailsRef];
  navigate: [patch: Partial<K8sUrlState>];
}>();

const store = useStore();
const { t } = useI18nTyped();

const EVENT_LIMIT = 100;

const MEMBER_KINDS: ReadonlySet<string> = new Set([
  "deployment",
  "daemonset",
  "statefulset",
  "replicaset",
  "job",
]);

const PHASE_TONE: Record<string, Tone> = {
  Active: "success",
  Terminating: "error",
  Bound: "success",
  Pending: "warning",
  Lost: "error",
};

const body = ref<HTMLElement | null>(null);

const info = computed(() => KIND_INFO[props.details.kind]);

const title = computed(() =>
  t("infra.k8s2.drawerTitle", { kind: t(info.value.title), name: raw(props.details.name) }),
);

const subTitle = computed(() =>
  raw([props.details.namespace, props.details.cluster].filter(Boolean).join(" · ")),
);

const headerStatus = computed<{ text: I18nText; tone: Tone } | null>(() => {
  const row = props.row;
  if ((row?.kind === "pod" || row?.kind === "node") && row.status) {
    return { text: chipLabel(row.status, t), tone: toneOf(row.status.variant) };
  }
  if ((row?.kind === "pvc" || row?.kind === "namespace") && row.phase) {
    return { text: raw(row.phase), tone: PHASE_TONE[row.phase] ?? "neutral" };
  }
  return null;
});

const end = computed(() => props.range.end);

const dateOf = (us: number) =>
  timestampToTimezoneDate(
    Math.floor(us / 1000),
    store.state.timezone ?? "UTC",
    "yyyy-MM-dd HH:mm:ss",
  );

const agoAt = (us: number | null) =>
  us == null
    ? null
    : t("infra.k8s2.drawerAgoAt", { age: formatAge(end.value - us), date: dateOf(us) });

const uid = computed(() =>
  props.row?.kind === "pod" ? props.row.uid : (props.row?.object?.uid ?? null),
);

const badges = (map: Record<string, unknown> | null) =>
  map ? Object.entries(map).map(([k, v]) => `${k}=${v}`) : null;

const labels = computed(() =>
  props.row?.object ? (badges(labelsOf(props.row.object)) ?? []) : null,
);

const annotations = computed(() => {
  const value = props.row?.object?.metadata?.annotations;
  return props.row?.object ? (badges(value && typeof value === "object" ? value : {}) ?? []) : null;
});

const controller = computed<Owner | null>(() => {
  const row = props.row;
  if (!row) return null;
  if (row.kind === "pod") return row.controller;
  if (row.kind === "replicaset" || row.kind === "job") return row.owner;
  const refs: any[] = row.object?.metadata?.ownerReferences ?? [];
  const ref = refs.find((r) => r?.controller === true);
  return ref?.kind && ref?.name ? { kind: String(ref.kind), name: String(ref.name) } : null;
});

const controllerKind = computed(() =>
  controller.value ? detailKindOf(controller.value.kind) : null,
);

const shownEvents = computed(() => (props.events ?? []).slice(0, EVENT_LIMIT));

const openRef = (ref: DetailsRef) => emit("open", ref);

const openNamespace = () =>
  openRef({
    kind: "namespace",
    cluster: props.details.cluster,
    namespace: "",
    name: props.details.namespace,
  });

const openController = () => {
  if (!controller.value || !controllerKind.value) return;
  openRef({
    kind: controllerKind.value,
    cluster: props.details.cluster,
    namespace: KIND_INFO[controllerKind.value].namespaced ? props.details.namespace : "",
    name: controller.value.name,
  });
};

watch(
  () => encodeDetails(props.details),
  () => {
    const scroller = body.value?.parentElement;
    if (scroller) scroller.scrollTop = 0;
  },
);

const copyName = () =>
  copyToClipboard(props.details.name, t, { successMessage: t("infra.k8s2.drawerCopied") });

const ageText = computed(() =>
  props.row?.createdAt == null
    ? null
    : t("infra.k8s2.drawerAgeOld", { age: formatAge(end.value - props.row.createdAt) }),
);

const insight = computed(() => {
  const warnings = props.row?.warnings ?? [];
  if (!warnings.length) return null;
  return {
    variant: severityOf(warnings) === "error" ? ("error" as const) : ("warning" as const),
    content: raw(warnings.map((w) => String(warningLabel(w, t, end.value))).join("\n")),
  };
});

const isWorkload = computed(() => MEMBER_KINDS.has(props.details.kind));

const worstMember = computed(() =>
  isWorkload.value && props.row ? worstPod(membersOf(props.inventory.pods, props.row)) : null,
);

const hasLogs = computed(() => props.details.kind === "pod" || isWorkload.value);

const hasTraces = computed(() => hasLogs.value);

const noMember = computed(() => isWorkload.value && !worstMember.value);

const act = (type: K8sAction) => {
  const pod = worstMember.value;
  if (pod && (type === "logs" || type === "traces")) {
    emit("action", type, {
      kind: "pod",
      cluster: pod.cluster,
      namespace: pod.namespace,
      name: pod.name,
    });
    return;
  }
  emit("action", type, props.details);
};

const showPods = () => emit("navigate", { view: "pods", search: props.details.name });
</script>

<template>
  <ODrawer
    :open="true"
    side="right"
    size="lg"
    seamless
    :modal="false"
    :anchor="anchor"
    :title="title"
    :sub-title="subTitle"
    data-test="k8s2-details-drawer"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <template #header>
      <div class="flex min-w-0 flex-col gap-1" data-test="k8s2-drawer-header">
        <OText variant="meta" data-test="k8s2-drawer-kind">{{ t(info.title) }}</OText>
        <div class="flex min-w-0 items-center gap-1">
          <OTruncatedText class="text-base font-semibold" data-test="k8s2-drawer-name">{{
            raw(details.name)
          }}</OTruncatedText>
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            icon-left="content-copy"
            :aria-label="t('infra.k8s2.drawerCopyName')"
            data-test="k8s2-drawer-copy"
            @click="copyName"
          />
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <OTag
            v-if="headerStatus"
            size="xs"
            :variant="TONE_PILL[headerStatus.tone].variant"
            :icon="TONE_PILL[headerStatus.tone].icon"
            data-test="k8s2-drawer-status"
            >{{ headerStatus.text }}</OTag
          >
          <OTruncatedText class="text-text-secondary text-xs" data-test="k8s2-drawer-subtitle">{{
            raw([subTitle, ageText].filter(Boolean).join(" · "))
          }}</OTruncatedText>
        </div>
      </div>
    </template>
    <div ref="body" class="flex flex-col gap-5">
      <div v-if="!row" class="flex justify-center py-6">
        <OSpinner v-if="pending" size="md" data-test="k8s2-drawer-pending" />
        <OText v-else variant="meta" data-test="k8s2-drawer-not-found">{{
          t("infra.k8s2.drawerNotFound")
        }}</OText>
      </div>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2" data-test="k8s2-drawer-actions">
          <OButton
            v-if="details.kind === 'node'"
            variant="primary"
            size="sm-action"
            icon-left="view-in-ar"
            data-test="k8s2-drawer-action-pods"
            @click="showPods"
            >{{ t("infra.k8s2.drawerActionPods") }}</OButton
          >
          <OButton
            v-if="hasLogs"
            variant="primary"
            size="sm-action"
            icon-left="article"
            :disabled="noMember"
            focusable-unavailable
            data-test="k8s2-drawer-view-logs"
            @click="act('logs')"
            >{{ t("infra.k8s2.drawerActionLogs") }}
            <OTooltip v-if="noMember" :content="t('infra.k8s2.drawerNoMemberPods')"
          /></OButton>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="data-object"
            data-test="k8s2-drawer-action-yaml"
            @click="act('yaml')"
            >{{ t("infra.k8s2.drawerActionYaml") }}</OButton
          >
          <OButton
            v-if="hasTraces"
            variant="outline"
            size="sm-action"
            icon-left="account-tree"
            :disabled="noMember"
            focusable-unavailable
            data-test="k8s2-drawer-action-traces"
            @click="act('traces')"
            >{{ t("infra.k8s2.drawerActionTraces") }}
            <OTooltip v-if="noMember" :content="t('infra.k8s2.drawerNoMemberPods')"
          /></OButton>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="show-chart"
            data-test="k8s2-drawer-action-metrics"
            @click="act('metrics')"
            >{{ t("infra.k8s2.drawerActionMetrics") }}</OButton
          >
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="auto-awesome"
            disabled
            focusable-unavailable
            data-test="k8s2-drawer-action-explain"
            >{{ t("infra.k8s2.drawerActionExplain") }}
            <OTooltip :content="t('infra.k8s2.drawerExplainUnavailable')" />
          </OButton>
        </div>
        <OBanner
          v-if="eventsScoped && !pending && !observed"
          variant="info"
          dense
          :content="t('infra.k8s2.objectsNotObserved')"
          data-test="k8s2-drawer-not-observed"
        />

        <OBanner
          v-if="insight"
          :variant="insight.variant"
          dense
          preserve-whitespace
          :content="insight.content"
          data-test="k8s2-drawer-insight"
        />

        <section class="flex flex-col gap-2" data-test="k8s2-drawer-section-metadata">
          <OText variant="card-title" as="h3" class="border-border-default border-b pb-1">{{
            t("infra.k8s2.drawerProperties")
          }}</OText>
          <ODescriptionList dense>
            <ODescriptionItem :label="t('infra.k8s2.drawerCreated')">
              <template v-if="row.createdAt != null">{{ agoAt(row.createdAt) }}</template>
            </ODescriptionItem>
            <ODescriptionItem :label="t('infra.k8s2.columnName')">{{
              raw(row.name)
            }}</ODescriptionItem>
            <ODescriptionItem
              v-if="info.namespaced"
              :label="t('infra.k8s2.columnNamespace')"
              data-test="k8s2-drawer-namespace"
            >
              <OButton
                variant="ghost-primary"
                size="xs"
                data-test="k8s2-drawer-namespace-link"
                @click="openNamespace"
                >{{ raw(details.namespace) }}</OButton
              >
            </ODescriptionItem>
            <ODescriptionItem :label="t('infra.k8s2.drawerUid')" data-test="k8s2-drawer-uid">
              <template v-if="uid">{{ raw(uid) }}</template>
            </ODescriptionItem>
            <ODescriptionItem
              v-for="field in [
                { id: 'labels', label: t('infra.k8s2.drawerLabels'), items: labels },
                { id: 'annotations', label: t('infra.k8s2.drawerAnnotations'), items: annotations },
              ]"
              :key="field.id"
              :label="field.label"
              :data-test="`k8s2-drawer-${field.id}`"
            >
              <div v-if="field.items?.length" class="flex flex-col items-start gap-1">
                <OTag v-for="s in field.items" :key="s" size="sm" variant="default-soft">{{
                  raw(s)
                }}</OTag>
              </div>
              <span v-else-if="field.items === null" data-test="k8s2-drawer-not-observed-value"
                >{{ raw("—") }}<OTooltip :content="t('infra.k8s2.drawerNotObserved')"
              /></span>
            </ODescriptionItem>
            <ODescriptionItem
              :label="t('infra.k8s2.drawerControlledBy')"
              data-test="k8s2-drawer-controlled-by"
            >
              <template v-if="controller">
                {{ raw(controller.kind) }}
                <OButton
                  v-if="controllerKind"
                  variant="ghost-primary"
                  size="xs"
                  data-test="k8s2-drawer-owner-link"
                  @click="openController"
                  >{{ raw(controller.name) }}</OButton
                >
                <template v-else>{{ raw(controller.name) }}</template>
              </template>
            </ODescriptionItem>
          </ODescriptionList>
        </section>

        <K8sDrawerMetrics
          :details="details"
          :row="row"
          :inventory="inventory"
          :range="range"
          :refresh-nonce="refreshNonce"
          :has-stream="hasStream"
        />

        <section class="flex flex-col gap-2" data-test="k8s2-drawer-section-kind">
          <OText variant="card-title" as="h3" class="border-border-default border-b pb-1">{{
            t(info.title)
          }}</OText>
          <PodDetails v-if="row.kind === 'pod'" :row="row" @open="openRef" />
          <NodeDetails
            v-else-if="row.kind === 'node'"
            :row="row"
            :inventory="inventory"
            :end="end"
            @open="openRef"
          />
          <WorkloadDetails v-else :row="row" :inventory="inventory" :end="end" @open="openRef" />
        </section>

        <section class="flex flex-col gap-2" data-test="k8s2-drawer-section-events">
          <OText variant="card-title" as="h3" class="border-border-default border-b pb-1">{{
            t("infra.k8s2.drawerEvents")
          }}</OText>
          <OText v-if="!hasEvents" variant="meta" data-test="k8s2-drawer-events-no-stream">{{
            t("infra.k8s2.drawerEventsNoStream", { stream: raw("k8s_events") })
          }}</OText>
          <OText v-else-if="!eventsScoped" variant="meta" data-test="k8s2-drawer-events-unscoped">{{
            t("infra.k8s2.drawerEventsUnscoped")
          }}</OText>
          <OText v-else-if="eventsFailed" variant="meta" data-test="k8s2-drawer-events-failed">{{
            t("infra.k8s2.drawerEventsFailed")
          }}</OText>
          <OSpinner v-else-if="events === null" size="sm" data-test="k8s2-drawer-events-pending" />
          <OText
            v-else-if="!shownEvents.length"
            variant="meta"
            data-test="k8s2-drawer-events-empty"
            >{{ t("infra.k8s2.drawerEventsEmpty") }}</OText
          >
          <template v-else>
            <div
              v-for="event in shownEvents"
              :key="event.key"
              class="border-border-default flex flex-col gap-1 border-b pb-2"
              data-test="k8s2-drawer-event"
            >
              <OText
                variant="body-strong"
                :class="event.type === 'Warning' ? 'text-status-error-text' : ''"
                >{{ raw(event.note) }}</OText
              >
              <ODescriptionList dense>
                <ODescriptionItem :label="t('infra.k8s2.drawerReason')">
                  <template v-if="event.reason">{{ raw(event.reason) }}</template>
                </ODescriptionItem>
                <ODescriptionItem :label="t('infra.k8s2.drawerSource')">
                  <template v-if="event.source">{{ raw(event.source) }}</template>
                </ODescriptionItem>
                <ODescriptionItem :label="t('infra.k8s2.drawerCount')">
                  <template v-if="event.count != null">{{ raw(String(event.count)) }}</template>
                </ODescriptionItem>
                <ODescriptionItem :label="t('infra.k8s2.drawerLastSeen')">
                  <template v-if="event.lastSeen != null">{{ agoAt(event.lastSeen) }}</template>
                </ODescriptionItem>
              </ODescriptionList>
            </div>
          </template>
        </section>
      </template>
    </div>
  </ODrawer>
</template>
