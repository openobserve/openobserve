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
import { useRouter } from "vue-router";
import { gt, raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import useStreams from "@/composables/useStreams";
import { timestampToTimezoneDate } from "@/utils/timezone";
import K8sDrawerMetrics from "./K8sDrawerMetrics.vue";
import PodDetails from "./PodDetails.vue";
import NodeDetails from "./NodeDetails.vue";
import WorkloadDetails from "./WorkloadDetails.vue";
import { KIND_INFO } from "./kubernetesQueries";
import { detailKindOf, type EventRow } from "./kubernetesEvents";
import { labelsOf } from "./kubernetesObjects";
import { encodeDetails, type DetailsRef } from "./kubernetesUrlState";
import {
  TONE_TEXT_CLASS,
  chipLabel,
  formatAge,
  toneOf,
  type AnyRow,
  type Inventory,
  type Owner,
  type Tone,
} from "./kubernetesModel";
import { resolvePodLogs } from "./podLogsLink";

const props = defineProps<{
  details: DetailsRef;
  row: AnyRow | null;
  inventory: Inventory;
  pending: boolean;
  observed: boolean;
  eventsScoped: boolean;
  events: EventRow[] | null;
  range: { start: number; end: number };
  refreshNonce: number;
  orgId: string;
  hasStream: (stream: string) => boolean;
  anchor: string;
}>();

const emit = defineEmits<{ close: []; open: [ref: DetailsRef] }>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
// useStreams injects the store, which only works during setup, never inside a click handler.
const streamsApi = useStreams(gt);

const EVENT_LIMIT = 100;

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

const logsBusy = ref(false);

const viewLogs = async () => {
  if (logsBusy.value) return;
  const { cluster, namespace, name } = props.details;
  logsBusy.value = true;
  const link = await resolvePodLogs(
    { cluster, namespace, pod: name },
    { orgId: props.orgId, start: props.range.start, end: props.range.end, multiCluster: false },
    streamsApi,
  ).finally(() => (logsBusy.value = false));
  if (!link) {
    toast({ variant: "warning", message: t("infra.k8s2.logsNoStream") });
    return;
  }
  if (link.warnNoClusterField) {
    toast({ variant: "warning", message: t("infra.k8s2.logsNoClusterField") });
  }
  // Logs restores its previous session from the store while initialized, ignoring these params.
  store.dispatch("logs/setIsInitialized", false);
  router.push(link.route);
};
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
    <template #header-right>
      <span
        v-if="headerStatus"
        :class="TONE_TEXT_CLASS[headerStatus.tone]"
        class="text-sm"
        data-test="k8s2-drawer-status"
        >{{ headerStatus.text }}</span
      >
      <OButton
        v-if="details.kind === 'pod'"
        variant="outline"
        size="sm-action"
        icon-left="article"
        data-test="k8s2-drawer-view-logs"
        :loading="logsBusy"
        :disabled="logsBusy"
        @click="viewLogs"
        >{{ t("infra.k8s2.viewLogs") }}</OButton
      >
    </template>
    <div ref="body" class="flex flex-col gap-5">
      <div v-if="!row" class="flex justify-center py-6">
        <OSpinner v-if="pending" size="md" data-test="k8s2-drawer-pending" />
        <OText v-else variant="meta" data-test="k8s2-drawer-not-found">{{
          t("infra.k8s2.drawerNotFound")
        }}</OText>
      </div>
      <template v-else>
        <OBanner
          v-if="eventsScoped && !pending && !observed"
          variant="info"
          dense
          :content="t('infra.k8s2.objectsNotObserved')"
          data-test="k8s2-drawer-not-observed"
        />

        <K8sDrawerMetrics
          :details="details"
          :row="row"
          :inventory="inventory"
          :range="range"
          :refresh-nonce="refreshNonce"
          :has-stream="hasStream"
        />

        <section class="flex flex-col gap-2" data-test="k8s2-drawer-section-metadata">
          <OText variant="card-title" as="h3" class="border-border-default border-b pb-1">{{
            t("infra.k8s2.drawerMetadata")
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
          <OText v-if="!eventsScoped" variant="meta" data-test="k8s2-drawer-events-unscoped">{{
            t("infra.k8s2.drawerEventsUnscoped")
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
