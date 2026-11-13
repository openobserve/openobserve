<template>
  <section class="flex flex-col gap-1" data-test="svcver-pods">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-text-secondary text-xs font-medium">{{ title }}</span>
      <OButton
        class="ms-auto"
        variant="ghost-primary"
        size="xs"
        :disabled="busy"
        data-test="svcver-evidence-podEvents-pods"
        @click="openEvents"
        >{{ t("serviceVersions.compare.pods.events") }}</OButton
      >
    </div>
    <OTable
      :data="rows"
      :columns="columns"
      row-key="id"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      :fill-height="false"
      frame
      data-test="svcver-pods-table"
      ><template #cell-pod="{ row }"
        ><span class="truncate font-mono text-xs" :data-test="`svcver-pod-${row.id}`">{{
          row.pod.k8s_pod
        }}</span></template
      ><template #cell-version
        ><span class="font-mono text-xs">{{ result.arms.a.version }}</span></template
      ><template #cell-status="{ row }"
        ><span class="text-xs" :data-test="`svcver-pod-status-${row.id}`">{{
          statusLabel(row.pod.status)
        }}</span></template
      ><template #cell-ready="{ row }"
        ><span
          class="text-xs tabular-nums"
          :class="{ 'text-error-600 font-semibold': row.pod.ready === false }"
          :data-test="`svcver-pod-ready-${row.id}`"
          >{{ readyLabel(row.pod.ready) }}</span
        ></template
      ><template #cell-requests="{ row }"
        ><span class="text-xs tabular-nums" :data-test="`svcver-pod-requests-${row.id}`">{{
          0
        }}</span></template
      ><template #cell-started="{ row }"
        ><span class="text-xs tabular-nums">{{ formatTime(row.pod.since) }}</span></template
      ><template #cell-link="{ row }"
        ><OButton
          variant="ghost-primary"
          size="xs"
          :disabled="busy"
          :data-test="`svcver-evidence-podLogs-${row.id}`"
          @click="openLogs(row.pod)"
          >{{ t("serviceVersions.compare.pods.logs") }}</OButton
        ></template
      ></OTable
    >
    <p v-if="hidden" class="text-text-secondary text-xs" data-test="svcver-pods-more">
      {{ t("serviceVersions.compare.pods.more", { count: total - pods.length }) }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { gt, raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import useStreams from "@/composables/useStreams";
import { resolvePodLogs } from "@/views/Infrastructure/kubernetes2/podLogsLink";
import type { CompareResponse, NotServingPod } from "@/services/service_versions";
import { resolvePodEvents } from "./podLinks";
import { formatSpan, formatTime } from "./VersionSummaryTiles.format";
import { whereSentence } from "@/utils/serviceVersionsCopy";
const props = defineProps<{
  org: string;
  result: CompareResponse;
  pods: NotServingPod[];
  total?: number;
}>();
const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
// useStreams injects the store, which only works during setup, never inside a click handler.
const streamsApi = useStreams(gt);
const busy = ref(false);
const rows = computed(() =>
  props.pods.map((pod) => ({ id: `${pod.k8s_cluster}/${pod.k8s_namespace}/${pod.k8s_pod}`, pod })),
);
const title = computed(() =>
  whereSentence(
    {
      in: "serviceVersions.compare.pods.title",
      outside: "serviceVersions.compare.pods.titleOutside",
    },
    props.result.where_key,
    null,
    {},
    t,
  ),
);
const hidden = computed(() => (props.total ?? 0) > props.pods.length);
const total = computed(() => props.total ?? props.pods.length);
// The pods started before the arm window opened, so their own start bounds the search.
const range = computed(() => ({
  start: Math.min(props.result.arms.a.start_time, ...props.pods.map((pod) => pod.since)),
  end: props.result.arms.a.end_time,
}));
const columns = computed<OTableColumnDef<(typeof rows.value)[number]>[]>(() => [
  { id: "pod", header: t("serviceVersions.compare.pods.column.pod"), size: 260 },
  { id: "version", header: t("serviceVersions.compare.pods.column.version"), size: 100 },
  { id: "status", header: t("serviceVersions.compare.pods.column.status"), size: 120 },
  {
    id: "ready",
    header: t("serviceVersions.compare.pods.column.ready"),
    size: 70,
    meta: { align: "right" },
  },
  {
    id: "requests",
    header: t("serviceVersions.compare.pods.column.requests", {
      window: formatSpan(
        wholeMinutes(props.result.arms.a.end_time - props.result.arms.a.start_time),
      ),
    }),
    size: 130,
    meta: { align: "right" },
  },
  { id: "started", header: t("serviceVersions.compare.pods.column.started"), size: 100 },
  { id: "link", header: raw(""), size: 100, isAction: true },
]);
function statusLabel(status: string | undefined) {
  if (!status) return "—";
  return status === "running" ? t("serviceVersions.compare.pods.status.running") : status;
}
function readyLabel(ready: boolean | undefined) {
  if (ready === undefined) return "—";
  return t(
    ready ? "serviceVersions.compare.pods.ready.yes" : "serviceVersions.compare.pods.ready.no",
  );
}
function visit(route: Parameters<typeof router.push>[0]) {
  // Logs restores its previous session from the store while initialized, ignoring these params.
  store.dispatch("logs/setIsInitialized", false);
  void router.push(route);
}
async function resolve<T>(read: () => Promise<T>): Promise<T | null> {
  if (busy.value) return null;
  busy.value = true;
  try {
    return await read();
  } catch {
    toast({ variant: "error", message: t("serviceVersions.compare.pods.linkFailed") });
    return null;
  } finally {
    busy.value = false;
  }
}
async function openEvents() {
  if (busy.value) return;
  const link = await resolve(() =>
    resolvePodEvents(props.pods, { orgId: props.org, ...range.value }, streamsApi).then(
      (found) => found ?? false,
    ),
  );
  if (link === false)
    toast({ variant: "warning", message: t("serviceVersions.compare.pods.eventsNoStream") });
  else if (link) visit(link.route);
}
async function openLogs(pod: NotServingPod) {
  if (busy.value) return;
  const link = await resolve(() =>
    resolvePodLogs(
      { cluster: pod.k8s_cluster, namespace: pod.k8s_namespace, pod: pod.k8s_pod },
      {
        orgId: props.org,
        ...range.value,
        multiCluster: new Set(props.pods.map((row) => row.k8s_cluster)).size > 1,
      },
      streamsApi,
    ).then((found) => found ?? false),
  );
  if (link === false) {
    toast({ variant: "warning", message: t("serviceVersions.compare.pods.logsNoStream") });
    return;
  }
  if (!link) return;
  if (link.warnNoClusterField)
    toast({ variant: "warning", message: t("serviceVersions.compare.pods.logsNoClusterField") });
  visit(link.route);
}
// The header prints clock minutes, so a 4m59s window must read 5m here, not 4m.
function wholeMinutes(us: number) {
  return us >= 60e6 ? Math.round(us / 60e6) * 60e6 : us;
}
</script>
