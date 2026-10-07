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
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { timestampToTimezoneDate } from "@/utils/timezone";
import ContainerSquares from "./ContainerSquares.vue";
import type { DetailsRef } from "./kubernetesUrlState";
import {
  TONE_TEXT_CLASS,
  chipLabel,
  formatBytes,
  formatCores,
  toneOf,
  type ContainerRow,
  type PodRow,
} from "./kubernetesModel";

interface Condition {
  type: string;
  active: boolean;
  since: string | null;
}

interface ContainerView {
  row: ContainerRow;
  spec: Record<string, any> | null;
  status: Record<string, any> | null;
}

const props = defineProps<{ row: PodRow }>();

const emit = defineEmits<{ open: [ref: DetailsRef] }>();

const { t } = useI18nTyped();
const store = useStore();

const CONDITIONS = ["Initialized", "Ready", "ContainersReady", "PodScheduled"];

const object = computed(() => props.row.object);

const time = (iso: string | null | undefined) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms)
    ? timestampToTimezoneDate(ms, store.state.timezone ?? "UTC", "yyyy-MM-dd HH:mm:ss")
    : null;
};

const pairs = (map: unknown) =>
  map && typeof map === "object"
    ? Object.entries(map as Record<string, unknown>).map(([k, v]) => `${k}=${v}`)
    : [];

const podIps = computed(() =>
  ((object.value?.status?.podIPs ?? []) as any[]).map((p) => p?.ip).filter(Boolean),
);

const nodeSelector = computed(() => pairs(object.value?.spec?.nodeSelector));

const tolerations = computed(() =>
  ((object.value?.spec?.tolerations ?? []) as any[]).map((tol) => {
    const key = tol?.key ?? "";
    const value = tol?.value ? `=${tol.value}` : "";
    const effect = tol?.effect ? `:${tol.effect}` : "";
    return `${key}${value}${effect}` || String(tol?.operator ?? "");
  }),
);

const qosText = computed(() => {
  const qos = props.row.qos;
  if (!qos) return raw("—");
  return qos.estimated ? t("infra.k8s2.drawerQosEstimated", { cls: raw(qos.cls) }) : raw(qos.cls);
});

const conditions = computed<Condition[]>(() => {
  const observed = object.value?.status?.conditions;
  if (!Array.isArray(observed)) {
    return [
      { type: "Ready", active: props.row.ready === "true", since: null },
      { type: "PodScheduled", active: !!props.row.node, since: null },
    ];
  }
  return CONDITIONS.map((type) => {
    const c = observed.find((x: any) => x?.type === type);
    return { type, active: c?.status === "True", since: time(c?.lastTransitionTime) };
  });
});

const viewsOf = (init: boolean): ContainerView[] => {
  const specs: any[] =
    (init ? object.value?.spec?.initContainers : object.value?.spec?.containers) ?? [];
  const statuses: any[] =
    (init
      ? object.value?.status?.initContainerStatuses
      : object.value?.status?.containerStatuses) ?? [];
  const rows = props.row.containers.filter((c) => c.init === init);
  const names = new Set(rows.map((c) => c.name));
  // An object-only container has no metric row yet; it still gets a square, as unknown.
  const extra: ContainerRow[] = specs
    .filter((s) => s?.name && !names.has(s.name))
    .map((s) => ({
      name: String(s.name),
      init,
      image: s.image ?? null,
      ready: null,
      state: "unknown",
      running: false,
      waitingReason: null,
      terminatedReason: null,
      lastTerminatedReason: null,
      restarts: null,
      cpuRequest: null,
      cpuLimit: null,
      memoryRequest: null,
      memoryLimit: null,
    }));
  return [...rows, ...extra]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({
      row,
      spec: specs.find((s) => s?.name === row.name) ?? null,
      status: statuses.find((s) => s?.name === row.name) ?? null,
    }));
};

const initContainers = computed(() => (object.value ? viewsOf(true) : []));
const containers = computed(() => viewsOf(false));

const stateText = (c: ContainerRow): I18nText => {
  switch (c.state) {
    case "terminated":
      return t("infra.k8s2.containerTerminated", { reason: raw(c.terminatedReason ?? "") });
    case "restarted":
    case "ready":
      return t("infra.k8s2.containerRunningReady");
    case "waiting":
      return c.waitingReason
        ? t("infra.k8s2.containerWaitingReason", { reason: raw(c.waitingReason) })
        : t("infra.k8s2.containerWaiting");
    default:
      return t("infra.k8s2.containerUnknown");
  }
};

const lastStatus = (v: ContainerView): I18nText[] => {
  const terminated = v.status?.lastState?.terminated;
  const reason = v.row.lastTerminatedReason ?? terminated?.reason ?? null;
  const parts: I18nText[] = [];
  if (reason) parts.push(raw(reason));
  if (terminated?.exitCode != null) {
    parts.push(t("infra.k8s2.drawerExitCode", { code: terminated.exitCode }));
  }
  const started = time(terminated?.startedAt);
  if (started) parts.push(t("infra.k8s2.drawerStartedAt", { time: started }));
  const finished = time(terminated?.finishedAt);
  if (finished) parts.push(t("infra.k8s2.drawerFinishedAt", { time: finished }));
  return parts;
};

const ports = (spec: Record<string, any> | null) =>
  ((spec?.ports ?? []) as any[]).map((p) => {
    const port = `${p?.containerPort}/${p?.protocol ?? "TCP"}`;
    return p?.name ? `${p.name}: ${port}` : port;
  });

const REF_KINDS = ["secretKeyRef", "configMapKeyRef"];

// valueFrom stays unresolved: secrets and config maps are never read.
const env = (spec: Record<string, any> | null) =>
  ((spec?.env ?? []) as any[]).map((e) => {
    if (e?.value != null) return `${e.name}=${e.value}`;
    const from = e?.valueFrom ?? {};
    const refKind = REF_KINDS.find((k) => from[k]);
    if (refKind) return `${e.name}=${refKind} ${from[refKind].name}/${from[refKind].key}`;
    if (from.fieldRef) return `${e.name}=fieldRef ${from.fieldRef.fieldPath}`;
    if (from.resourceFieldRef)
      return `${e.name}=resourceFieldRef ${from.resourceFieldRef.resource}`;
    return `${e?.name}=`;
  });

const mounts = (spec: Record<string, any> | null) =>
  ((spec?.volumeMounts ?? []) as any[]).map(
    (m) => `${m?.mountPath} from ${m?.name} (${m?.readOnly ? "ro" : "rw"})`,
  );

// Lens's probe line (container-details.tsx getProbe).
const probe = (p: Record<string, any> | undefined) => {
  if (!p) return null;
  const parts: string[] = [];
  if (p.httpGet) {
    const { path = "", port, host = "", scheme = "HTTP" } = p.httpGet;
    parts.push("http-get", `${String(scheme).toLowerCase()}://${host}:${port}${path}`);
  }
  if (p.tcpSocket) parts.push("tcp-socket", `:${p.tcpSocket.port}`);
  if (p.exec?.command) parts.push("exec", `[${p.exec.command.join(" ")}]`);
  parts.push(
    `delay=${p.initialDelaySeconds || "0"}s`,
    `timeout=${p.timeoutSeconds || "0"}s`,
    `period=${p.periodSeconds || "0"}s`,
    `#success=${p.successThreshold || "0"}`,
    `#failure=${p.failureThreshold || "0"}`,
  );
  return parts.join(" ");
};

const PROBES = [
  { id: "liveness", field: "livenessProbe", label: "infra.k8s2.drawerLiveness" },
  { id: "readiness", field: "readinessProbe", label: "infra.k8s2.drawerReadiness" },
  { id: "startup", field: "startupProbe", label: "infra.k8s2.drawerStartup" },
] as const;

const resources = (c: ContainerRow, kind: "request" | "limit") => {
  const cpu = kind === "request" ? c.cpuRequest : c.cpuLimit;
  const memory = kind === "request" ? c.memoryRequest : c.memoryLimit;
  const parts: string[] = [];
  if (cpu != null) parts.push(`cpu: ${formatCores(cpu)}`);
  if (memory != null) parts.push(`memory: ${formatBytes(memory)}`);
  return parts.join(", ");
};

const openNode = () =>
  emit("open", {
    kind: "node",
    cluster: props.row.cluster,
    namespace: "",
    name: props.row.node ?? "",
  });

const sections = computed(() => [
  {
    id: "init-containers",
    title: t("infra.k8s2.drawerInitContainers"),
    items: initContainers.value,
  },
  { id: "containers", title: t("infra.k8s2.sectionContainers"), items: containers.value },
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <ODescriptionList dense>
      <ODescriptionItem :label="t('infra.k8s2.columnStatus')" data-test="k8s2-pod-status">
        <span v-if="row.status" :class="TONE_TEXT_CLASS[toneOf(row.status.variant)]">{{
          chipLabel(row.status, t)
        }}</span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.columnNode')">
        <OButton
          v-if="row.node"
          variant="ghost-primary"
          size="xs"
          data-test="k8s2-pod-node-link"
          @click="openNode"
          >{{ raw(row.node) }}</OButton
        >
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerPodIp')">
        <template v-if="row.ip">{{ raw(row.ip) }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerPodIps')" data-test="k8s2-pod-ips">
        <template v-if="podIps.length">{{ raw(podIps.join(", ")) }}</template>
      </ODescriptionItem>
      <ODescriptionItem
        :label="t('infra.k8s2.drawerServiceAccount')"
        data-test="k8s2-pod-service-account"
      >
        <template v-if="object?.spec?.serviceAccountName">{{
          raw(object.spec.serviceAccountName)
        }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerPriorityClass')">
        <template v-if="row.priorityClass">{{ raw(row.priorityClass) }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerQos')" data-test="k8s2-pod-qos">
        {{ qosText }}
        <OTooltip v-if="row.qos?.estimated" :content="t('infra.k8s2.drawerQosEstimatedTip')" />
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerConditions')">
        <div class="flex flex-wrap gap-1">
          <OTag
            v-for="c in conditions"
            :key="c.type"
            :variant="c.active ? 'success-soft' : 'default-soft'"
            size="sm"
            :class="{ 'opacity-50': !c.active }"
            :data-test="`k8s2-pod-condition-${c.type}`"
            :data-active="String(c.active)"
          >
            {{ raw(c.type) }}
            <OTooltip
              v-if="!c.active && c.since"
              :content="t('infra.k8s2.drawerLastTransition', { time: c.since })"
            />
          </OTag>
        </div>
      </ODescriptionItem>
      <ODescriptionItem
        :label="t('infra.k8s2.drawerNodeSelector')"
        data-test="k8s2-pod-node-selector"
      >
        <div v-if="nodeSelector.length" class="flex flex-col items-start gap-1">
          <OTag v-for="s in nodeSelector" :key="s" size="sm" variant="default-soft">{{
            raw(s)
          }}</OTag>
        </div>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerTolerations')" data-test="k8s2-pod-tolerations">
        <div v-if="tolerations.length" class="flex flex-col items-start gap-1">
          <OTag v-for="(s, i) in tolerations" :key="i" size="sm" variant="default-soft">{{
            raw(s)
          }}</OTag>
        </div>
      </ODescriptionItem>
    </ODescriptionList>

    <template v-for="section in sections" :key="section.id">
      <section
        v-if="section.items.length"
        class="flex flex-col gap-3"
        :data-test="`k8s2-pod-${section.id}`"
      >
        <OText variant="card-title" as="h4">{{ section.title }}</OText>
        <div
          v-for="v in section.items"
          :key="v.row.name"
          class="flex flex-col gap-1"
          :data-test="`k8s2-pod-container-${v.row.name}`"
        >
          <div class="flex items-center gap-2">
            <ContainerSquares :containers="[v.row]" />
            <OText variant="body-strong">{{ raw(v.row.name) }}</OText>
          </div>
          <ODescriptionList dense>
            <ODescriptionItem
              :label="t('infra.k8s2.columnStatus')"
              :data-test="`k8s2-pod-container-${v.row.name}-status`"
              >{{ stateText(v.row) }}</ODescriptionItem
            >
            <ODescriptionItem
              :label="t('infra.k8s2.drawerLastStatus')"
              :data-test="`k8s2-pod-container-${v.row.name}-last-status`"
            >
              <span v-for="(part, i) in lastStatus(v)" :key="i"
                ><template v-if="i">{{ raw(" · ") }}</template
                >{{ part }}</span
              >
            </ODescriptionItem>
            <ODescriptionItem
              :label="t('infra.k8s2.drawerImage')"
              :data-test="`k8s2-pod-container-${v.row.name}-image`"
            >
              <template v-if="v.row.image ?? v.spec?.image">{{
                raw(v.row.image ?? v.spec?.image)
              }}</template>
            </ODescriptionItem>
            <ODescriptionItem
              v-if="v.spec?.imagePullPolicy && v.spec.imagePullPolicy !== 'IfNotPresent'"
              :label="t('infra.k8s2.drawerPullPolicy')"
              :data-test="`k8s2-pod-container-${v.row.name}-pull-policy`"
              >{{ raw(v.spec.imagePullPolicy) }}</ODescriptionItem
            >
            <ODescriptionItem
              v-if="ports(v.spec).length"
              :label="t('infra.k8s2.drawerPorts')"
              :data-test="`k8s2-pod-container-${v.row.name}-ports`"
            >
              <div v-for="p in ports(v.spec)" :key="p">{{ raw(p) }}</div>
            </ODescriptionItem>
            <ODescriptionItem
              v-if="env(v.spec).length"
              :label="t('infra.k8s2.drawerEnvironment')"
              :data-test="`k8s2-pod-container-${v.row.name}-env`"
            >
              <div v-for="e in env(v.spec)" :key="e" class="break-all">{{ raw(e) }}</div>
            </ODescriptionItem>
            <ODescriptionItem
              v-if="mounts(v.spec).length"
              :label="t('infra.k8s2.drawerMounts')"
              :data-test="`k8s2-pod-container-${v.row.name}-mounts`"
            >
              <div v-for="m in mounts(v.spec)" :key="m">{{ raw(m) }}</div>
            </ODescriptionItem>
            <template v-for="p in PROBES" :key="p.id">
              <ODescriptionItem
                v-if="probe(v.spec?.[p.field])"
                :label="t(p.label)"
                :data-test="`k8s2-pod-container-${v.row.name}-${p.id}`"
                >{{ raw(probe(v.spec?.[p.field]) ?? "") }}</ODescriptionItem
              >
            </template>
            <ODescriptionItem
              v-if="v.spec?.command?.length"
              :label="t('infra.k8s2.drawerCommand')"
              :data-test="`k8s2-pod-container-${v.row.name}-command`"
              >{{ raw(v.spec.command.join(" ")) }}</ODescriptionItem
            >
            <ODescriptionItem
              v-if="v.spec?.args?.length"
              :label="t('infra.k8s2.drawerArguments')"
              :data-test="`k8s2-pod-container-${v.row.name}-args`"
              >{{ raw(v.spec.args.join(" ")) }}</ODescriptionItem
            >
            <ODescriptionItem
              v-if="!v.row.init"
              :label="t('infra.k8s2.drawerRequests')"
              :data-test="`k8s2-pod-container-${v.row.name}-requests`"
            >
              <template v-if="resources(v.row, 'request')">{{
                raw(resources(v.row, "request"))
              }}</template>
            </ODescriptionItem>
            <ODescriptionItem
              v-if="!v.row.init"
              :label="t('infra.k8s2.drawerLimits')"
              :data-test="`k8s2-pod-container-${v.row.name}-limits`"
            >
              <template v-if="resources(v.row, 'limit')">{{
                raw(resources(v.row, "limit"))
              }}</template>
            </ODescriptionItem>
          </ODescriptionList>
        </div>
      </section>
    </template>
  </div>
</template>
