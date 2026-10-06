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
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { timestampToTimezoneDate } from "@/utils/timezone";
import RelatedPodsTable from "./RelatedPodsTable.vue";
import { detailKindOf } from "./kubernetesEvents";
import type { DetailsRef } from "./kubernetesUrlState";
import {
  TONE_TEXT_CLASS,
  formatAge,
  formatBytes,
  membersOf,
  severityOf,
  sortRows,
  warningLabel,
  type AnyRow,
  type Inventory,
  type JobRow,
  type ReplicaSetRow,
  type Tone,
} from "./kubernetesModel";

interface Badge {
  text: string;
  variant: BadgeVariant;
  tip?: string;
}

interface JobEntry {
  name: string;
  job: JobRow | null;
}

const props = defineProps<{
  row: Exclude<AnyRow, { kind: "pod" } | { kind: "node" }>;
  inventory: Inventory;
  // µs; the picker END, for ages.
  end: number;
}>();

const emit = defineEmits<{ open: [ref: DetailsRef] }>();

const { t } = useI18nTyped();
const store = useStore();

const WITH_PODS = new Set(["deployment", "daemonset", "statefulset", "replicaset", "job"]);

const PHASE_TONE: Record<string, Tone> = {
  Active: "success",
  Terminating: "error",
  Bound: "success",
  Pending: "warning",
  Lost: "error",
};

const HPA_VARIANT: Record<string, BadgeVariant> = {
  AbleToScale: "success-soft",
  ScalingActive: "blue-soft",
  ScalingLimited: "error-soft",
};

const n = (value: number | null | undefined) => (value == null ? "—" : String(value));

const object = computed(() => props.row.object);

const pairs = (map: unknown) =>
  map && typeof map === "object"
    ? Object.entries(map as Record<string, unknown>).map(([k, v]) => `${k}=${v}`)
    : [];

const selector = computed(() => {
  const sel = object.value?.spec?.selector;
  const expressions = ((sel?.matchExpressions ?? []) as any[]).map(
    (e) => `${e?.key} ${e?.operator}${e?.values?.length ? ` (${e.values.join(", ")})` : ""}`,
  );
  return [...pairs(sel?.matchLabels), ...expressions];
});

const nodeSelector = computed(() => pairs(object.value?.spec?.template?.spec?.nodeSelector));

const strategy = computed(() => {
  const spec = object.value?.spec;
  if (props.row.kind === "deployment") return spec?.strategy?.type ?? null;
  if (props.row.kind === "daemonset") return spec?.updateStrategy?.type ?? null;
  return null;
});

const replicas = computed<I18nText | null>(() => {
  const r = props.row;
  if (r.kind === "deployment") {
    return t("infra.k8s2.drawerReplicasDeployment", {
      desired: n(r.desired),
      updated: n(r.updated),
      total: n(r.replicas),
      available: n(r.available),
      unavailable: n(r.unavailable),
    });
  }
  if (r.kind === "statefulset") {
    return t("infra.k8s2.drawerReplicasSet", {
      desired: n(r.replicas),
      current: n(r.current),
      ready: n(r.ready),
    });
  }
  if (r.kind === "replicaset") {
    return t("infra.k8s2.drawerReplicasSet", {
      desired: n(r.desired),
      current: n(r.current),
      ready: n(r.ready),
    });
  }
  return null;
});

const pods = computed(() => membersOf(props.inventory.pods, props.row));

const images = computed(() =>
  [
    ...new Set(
      pods.value.flatMap((p) =>
        p.containers.filter((c) => !c.init && c.image).map((c) => c.image as string),
      ),
    ),
  ].sort(),
);

const podStatus = computed(() => {
  const count = (phase: string) => pods.value.filter((p) => p.phase === phase).length;
  return [
    { text: t("infra.k8s2.drawerPodsRunning", { count: count("Running") }), tone: "success" },
    { text: t("infra.k8s2.drawerPodsPending", { count: count("Pending") }), tone: "warning" },
    { text: t("infra.k8s2.drawerPodsFailed", { count: count("Failed") }), tone: "error" },
  ] as Array<{ text: I18nText; tone: Tone }>;
});

const jobConditions = (job: JobRow): Badge[] => {
  const out: Badge[] = [];
  if (job.complete) out.push({ text: "Complete", variant: "success-soft" });
  if ((job.failed ?? 0) > 0) {
    out.push({ text: "Failed", variant: "error-soft", tip: job.failedReasons.join(", ") });
  }
  return out;
};

const conditions = computed<Badge[]>(() => {
  const r = props.row;
  if (r.kind === "deployment") return r.conditions.map((c) => ({ ...c }));
  if (r.kind === "job") return jobConditions(r);
  if (r.kind === "hpa") {
    return r.conditions.map((c) => ({
      text: c.condition,
      variant: HPA_VARIANT[c.condition] ?? "default-soft",
    }));
  }
  return [];
});

const revisions = computed(() => {
  const r = props.row;
  if (r.kind !== "deployment") return [];
  const owned = props.inventory.replicasets.filter(
    (rs) =>
      rs.cluster === r.cluster &&
      rs.namespace === r.namespace &&
      rs.owner?.kind === "Deployment" &&
      rs.owner.name === r.name,
  );
  return sortRows(owned, (rs) => rs.ready, true);
});

const jobs = computed<JobEntry[]>(() => {
  const r = props.row;
  if (r.kind !== "cronjob") return [];
  return r.jobs.map((name) => ({
    name,
    job:
      props.inventory.jobs.find(
        (j) => j.cluster === r.cluster && j.namespace === r.namespace && j.name === name,
      ) ?? null,
  }));
});

const age = (createdAt: number | null) =>
  formatAge(createdAt == null ? null : props.end - createdAt);

const when = (us: number | null) => {
  if (us == null) return null;
  const date = timestampToTimezoneDate(
    Math.floor(us / 1000),
    store.state.timezone ?? "UTC",
    "yyyy-MM-dd HH:mm:ss",
  );
  return t("infra.k8s2.drawerAgoAt", { age: age(us), date });
};

const revisionColumns = computed<OTableColumnDef<ReplicaSetRow>[]>(() => [
  { id: "name", header: t("infra.k8s2.columnName"), accessorFn: (rs) => rs.name },
  { id: "warn", header: raw(""), accessorFn: (rs) => rs.warnings.length, size: 40 },
  { id: "namespace", header: t("infra.k8s2.columnNamespace"), accessorFn: (rs) => rs.namespace },
  {
    id: "pods",
    header: t("infra.k8s2.columnPods"),
    accessorFn: (rs) => `${n(rs.ready)}/${n(rs.desired)}`,
  },
  { id: "age", header: t("infra.k8s2.drawerAge"), accessorFn: (rs) => age(rs.createdAt) },
]);

const jobColumns = computed<OTableColumnDef<JobEntry>[]>(() => [
  { id: "name", header: t("infra.k8s2.columnName"), accessorFn: (j) => j.name },
  {
    id: "condition",
    header: t("infra.k8s2.drawerCondition"),
    accessorFn: (j) =>
      j.job
        ? jobConditions(j.job)
            .map((c) => c.text)
            .join(", ")
        : "",
  },
  {
    id: "age",
    header: t("infra.k8s2.drawerAge"),
    accessorFn: (j) => age(j.job?.createdAt ?? null),
  },
]);

const open = (kind: DetailsRef["kind"], name: string) =>
  emit("open", { kind, cluster: props.row.cluster, namespace: props.row.namespace, name });

const hpaTargetKind = computed(() =>
  props.row.kind === "hpa" && props.row.target ? detailKindOf(props.row.target.kind) : null,
);

const phase = computed(() =>
  props.row.kind === "pvc" || props.row.kind === "namespace" ? props.row.phase : null,
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <ODescriptionList dense>
      <template v-if="row.kind === 'cronjob'">
        <ODescriptionItem :label="t('infra.k8s2.drawerSchedule')" data-test="k8s2-wl-schedule">
          <template v-if="row.schedule">{{ raw(row.schedule) }}</template>
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerActive')" data-test="k8s2-wl-active">
          {{ raw(n(row.active)) }}
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerSuspend')" data-test="k8s2-wl-suspend">
          {{ raw(row.suspend == null ? "—" : String(row.suspend)) }}
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerLastSchedule')">
          <template v-if="row.lastSchedule != null">{{ when(row.lastSchedule) }}</template>
        </ODescriptionItem>
      </template>

      <template v-if="row.kind === 'pvc'">
        <ODescriptionItem :label="t('infra.k8s2.drawerAccessModes')">
          <template v-if="object?.spec?.accessModes?.length">{{
            raw(object.spec.accessModes.join(", "))
          }}</template>
        </ODescriptionItem>
        <ODescriptionItem
          :label="t('infra.k8s2.drawerStorageClass')"
          data-test="k8s2-wl-storage-class"
        >
          <template v-if="row.storageClass">{{ raw(row.storageClass) }}</template>
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerStorage')">
          <template v-if="row.size != null">{{ raw(formatBytes(row.size)) }}</template>
        </ODescriptionItem>
      </template>

      <template v-if="row.kind === 'hpa'">
        <ODescriptionItem :label="t('infra.k8s2.drawerReference')" data-test="k8s2-wl-reference">
          <template v-if="row.target">
            {{ raw(row.target.kind) }}
            <OButton
              v-if="hpaTargetKind"
              variant="ghost-primary"
              size="xs"
              @click="open(hpaTargetKind, row.target.name)"
              >{{ raw(row.target.name) }}</OButton
            >
            <template v-else>{{ raw(row.target.name) }}</template>
          </template>
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerMinPods')" data-test="k8s2-wl-min">
          {{ raw(n(row.min)) }}
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerMaxPods')" data-test="k8s2-wl-max">
          {{ raw(n(row.max)) }}
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerReplicas')">
          {{ raw(n(row.current)) }}
        </ODescriptionItem>
      </template>

      <ODescriptionItem
        v-if="row.kind === 'pvc' || row.kind === 'namespace'"
        :label="t('infra.k8s2.columnStatus')"
        data-test="k8s2-wl-status"
      >
        <span v-if="phase" :class="TONE_TEXT_CLASS[PHASE_TONE[phase] ?? 'neutral']">{{
          raw(phase)
        }}</span>
      </ODescriptionItem>

      <ODescriptionItem
        v-if="replicas"
        :label="t('infra.k8s2.drawerReplicas')"
        data-test="k8s2-wl-replicas"
      >
        {{ replicas }}
      </ODescriptionItem>
      <template v-if="row.kind === 'job'">
        <ODescriptionItem :label="t('infra.k8s2.drawerCompletions')">
          {{ raw(`${n(row.succeeded)} / ${n(row.completions)}`) }}
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerParallelism')">
          <template v-if="object?.spec?.parallelism != null">{{
            raw(String(object.spec.parallelism))
          }}</template>
        </ODescriptionItem>
      </template>

      <template v-if="WITH_PODS.has(row.kind) || row.kind === 'pvc'">
        <ODescriptionItem :label="t('infra.k8s2.drawerSelector')" data-test="k8s2-wl-selector">
          <div v-if="selector.length" class="flex flex-col items-start gap-1">
            <OTag v-for="s in selector" :key="s" size="sm" variant="default-soft">{{
              raw(s)
            }}</OTag>
          </div>
        </ODescriptionItem>
      </template>
      <template v-if="WITH_PODS.has(row.kind)">
        <ODescriptionItem :label="t('infra.k8s2.drawerNodeSelector')">
          <div v-if="nodeSelector.length" class="flex flex-col items-start gap-1">
            <OTag v-for="s in nodeSelector" :key="s" size="sm" variant="default-soft">{{
              raw(s)
            }}</OTag>
          </div>
        </ODescriptionItem>
      </template>
      <ODescriptionItem
        v-if="row.kind === 'deployment' || row.kind === 'daemonset'"
        :label="t('infra.k8s2.drawerStrategy')"
        data-test="k8s2-wl-strategy"
      >
        <template v-if="strategy">{{ raw(strategy) }}</template>
      </ODescriptionItem>

      <ODescriptionItem
        v-if="row.kind === 'deployment' || row.kind === 'job' || row.kind === 'hpa'"
        :label="
          row.kind === 'hpa' ? t('infra.k8s2.columnStatus') : t('infra.k8s2.drawerConditions')
        "
        :data-test="row.kind === 'hpa' ? 'k8s2-wl-status' : 'k8s2-wl-conditions'"
      >
        <div v-if="conditions.length" class="flex flex-wrap gap-1">
          <OTag v-for="c in conditions" :key="c.text" size="sm" :variant="c.variant">
            {{ raw(c.text) }}
            <OTooltip v-if="c.tip" :content="raw(c.tip)" />
          </OTag>
          <OTooltip
            v-if="row.kind === 'deployment' && row.conditionsDerived"
            :content="t('infra.k8s2.drawerDerivedConditions')"
          />
        </div>
      </ODescriptionItem>

      <template v-if="WITH_PODS.has(row.kind)">
        <ODescriptionItem :label="t('infra.k8s2.drawerImages')" data-test="k8s2-wl-images">
          <template v-if="images.length">
            <div v-for="image in images" :key="image" class="break-all">{{ raw(image) }}</div>
          </template>
        </ODescriptionItem>
        <ODescriptionItem :label="t('infra.k8s2.drawerPodStatus')" data-test="k8s2-wl-pod-status">
          <span v-for="(s, i) in podStatus" :key="i" :class="TONE_TEXT_CLASS[s.tone]"
            ><template v-if="i">{{ raw(" ") }}</template
            >{{ s.text }}</span
          >
        </ODescriptionItem>
      </template>

      <ODescriptionItem
        v-if="row.kind === 'pvc'"
        :label="t('infra.k8s2.columnPods')"
        data-test="k8s2-wl-pods"
      >
        <div v-if="row.pods?.length" class="flex flex-col items-start">
          <OButton
            v-for="p in row.pods"
            :key="p"
            variant="ghost-primary"
            size="xs"
            @click="open('pod', p)"
            >{{ raw(p) }}</OButton
          >
        </div>
      </ODescriptionItem>
    </ODescriptionList>

    <section
      v-if="row.kind === 'deployment'"
      class="flex flex-col gap-2"
      data-test="k8s2-wl-revisions"
    >
      <OText variant="card-title" as="h4">{{ t("infra.k8s2.drawerRevisions") }}</OText>
      <OTable
        :data="revisions"
        :columns="revisionColumns"
        row-key="key"
        dense
        pagination="none"
        :frame="false"
        :show-global-filter="false"
      >
        <template #cell-name="{ row: rs }">
          <OButton variant="ghost-primary" size="xs" @click.stop="open('replicaset', rs.name)">{{
            raw(rs.name)
          }}</OButton>
        </template>
        <template #cell-warn="{ row: rs }">
          <span v-if="rs.warnings.length" class="inline-flex">
            <OIcon
              :name="severityOf(rs.warnings) === 'error' ? 'error' : 'warning'"
              size="sm"
              :class="
                severityOf(rs.warnings) === 'error'
                  ? 'text-status-error-text'
                  : 'text-status-warning-text'
              "
            />
            <OTooltip>
              <template #content>
                <div v-for="(w, i) in rs.warnings" :key="i">{{ warningLabel(w, t, end) }}</div>
              </template>
            </OTooltip>
          </span>
        </template>
      </OTable>
    </section>

    <section v-if="row.kind === 'cronjob'" class="flex flex-col gap-2" data-test="k8s2-wl-jobs">
      <OText variant="card-title" as="h4">{{ t("infra.k8s2.drawerJobs") }}</OText>
      <OTable
        :data="jobs"
        :columns="jobColumns"
        row-key="name"
        dense
        pagination="none"
        :frame="false"
        :show-global-filter="false"
      >
        <template #cell-name="{ row: j }">
          <OButton variant="ghost-primary" size="xs" @click.stop="open('job', j.name)">{{
            raw(j.name)
          }}</OButton>
        </template>
      </OTable>
    </section>

    <section v-if="WITH_PODS.has(row.kind)" class="flex flex-col gap-2">
      <OText variant="card-title" as="h4">{{ t("infra.k8s2.columnPods") }}</OText>
      <RelatedPodsTable :pods="pods" :end="end" @open="(r: DetailsRef) => emit('open', r)" />
    </section>
  </div>
</template>
