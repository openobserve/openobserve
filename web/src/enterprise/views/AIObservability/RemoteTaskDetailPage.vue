<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  One Remote Task head.

  Addressed by `entityId`, not by a version row id, so the page survives every
  publish. The head is shown at its newest published version — or at its draft
  when it has never published one, which is the same fallback the GET route
  makes, so the page and the API agree on what "the task" means.

  The stat strip carries only what the API can answer. Run counts, success rate,
  and latency percentiles need a per-task aggregate that does not exist yet, and
  a number that is wrong is worse than a number that is absent.
-->
<template>
  <OPageLayout
    data-test="ai-remote-task-detail-page"
    :back="{
      label: t('aiObservability.remoteTasks.detail.backTo'),
      onClick: goBack,
      dataTest: 'ai-remote-task-detail-back-btn',
    }"
    bleed
    :scroll="false"
  >
    <template #title>
      <span class="flex flex-wrap items-center gap-2">
        <span class="font-mono" data-test="ai-remote-task-detail-title">{{ title }}</span>
        <template v-if="task">
          <OTag v-if="versionLabel(task)" variant="default-soft" shape="rounded">
            {{ versionLabel(task) }}
          </OTag>
          <OTag type="remoteTaskAuth" :value="task.auth.type" />
          <OTag v-if="task.signing.enabled" variant="success-soft" icon="lock">
            {{ t("aiObservability.remoteTasks.signingOn") }}
          </OTag>
          <OTag type="remoteTaskStatus" :value="state" data-test="ai-remote-task-detail-state" />
        </template>
      </span>
    </template>

    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="edit"
        :disabled="!canEdit"
        data-test="ai-remote-task-detail-edit-btn"
        @click="openEdit"
      >
        {{ t("aiObservability.remoteTasks.edit") }}
        <OTooltip
          v-if="!canEdit"
          side="bottom"
          :content="t('aiObservability.remoteTasks.editSecretLocked')"
        />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="ai-remote-task-detail-refresh-btn"
        @click="refresh"
      >
        <OTooltip side="bottom" :content="t('common.refresh')" />
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs v-model="currentTab" dense align="left" data-test="ai-remote-task-detail-tabs">
        <OTab
          name="configuration"
          :label="t('aiObservability.remoteTasks.detail.tabs.overview')"
          data-test="ai-remote-task-detail-tab-configuration"
        />
        <OTab
          name="versions"
          :label="t('aiObservability.remoteTasks.detail.tabs.versions')"
          data-test="ai-remote-task-detail-tab-versions"
        />
        <OTab
          name="usedBy"
          :label="t('aiObservability.remoteTasks.detail.tabs.usedBy')"
          data-test="ai-remote-task-detail-tab-used-by"
        />
        <OTab
          name="signing"
          :label="t('aiObservability.remoteTasks.detail.tabs.signing')"
          data-test="ai-remote-task-detail-tab-signing"
        />
      </OTabs>
    </template>

    <div v-if="task" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- What the task IS, in one line: the call it makes, and why it exists. -->
      <div
        class="border-border-default flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-3 py-2.5 text-xs"
        data-test="ai-remote-task-detail-meta"
      >
        <span class="text-text-secondary">
          {{ t("aiObservability.remoteTasks.detail.endpointPrefix") }}
        </span>
        <span class="text-text-body font-mono">{{ task.httpMethod }} {{ task.endpoint }}</span>
        <span class="text-text-secondary">{{ separator }}</span>
        <span class="text-text-secondary italic">
          {{ task.description || t("aiObservability.remoteTasks.detail.noDescription") }}
        </span>
      </div>

      <div class="border-border-default border-b px-3 py-2.5">
        <OStatStrip :items="stats" :loading="loading" data-test="ai-remote-task-detail-stats" />
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <template v-if="currentTab === 'configuration'">
          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.identity')"
            data-test="ai-remote-task-detail-identity"
          >
            <dl :class="FIELD_GRID">
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.name") }}</dt>
              <dd class="font-mono">{{ task.name }}</dd>
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.description") }}</dt>
              <dd>
                {{ task.description || t("aiObservability.remoteTasks.detail.noDescription") }}
              </dd>
            </dl>
          </RemoteTaskDetailSection>

          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.endpoint')"
            data-test="ai-remote-task-detail-endpoint"
          >
            <dl :class="FIELD_GRID">
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.url") }}</dt>
              <dd class="font-mono break-all">{{ task.endpoint }}</dd>
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.method") }}</dt>
              <dd><OTag type="httpMethod" :value="task.httpMethod" /></dd>
            </dl>
          </RemoteTaskDetailSection>

          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.authentication')"
            data-test="ai-remote-task-detail-auth"
          >
            <dl :class="FIELD_GRID">
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.auth") }}</dt>
              <dd><OTag type="remoteTaskAuth" :value="task.auth.type" /></dd>
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.requestSigning") }}</dt>
              <dd>
                <span v-if="task.signing.enabled" class="text-text-body">
                  {{ t("aiObservability.remoteTasks.detail.signingOn") }}
                  <code class="font-mono">{{ signatureHeaderName }}</code>
                </span>
                <span v-else class="text-text-secondary">
                  {{ t("aiObservability.remoteTasks.detail.signingOff") }}
                </span>
              </dd>
            </dl>
          </RemoteTaskDetailSection>

          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.headers')"
            data-test="ai-remote-task-detail-headers"
          >
            <div v-if="task.customHeaders.length" class="flex flex-col gap-1.5">
              <div
                v-for="header in task.customHeaders"
                :key="header.key"
                class="flex flex-wrap items-center gap-2 text-xs"
              >
                <code class="text-text-body rounded-default bg-card-bg px-2 py-0.5 font-mono">
                  {{ header.key }}
                </code>
                <!-- A Secret-backed header reports that it is, never what. -->
                <OTag v-if="header.usesSecret" variant="purple-soft" icon="lock">
                  {{ t("aiObservability.remoteTasks.detail.headerSecret") }}
                </OTag>
                <span v-else class="text-text-secondary font-mono">{{ header.value }}</span>
              </div>
            </div>
            <span v-else class="text-text-secondary text-xs">
              {{ t("aiObservability.remoteTasks.detail.headersNone") }}
            </span>
            <span class="text-text-secondary text-2xs mt-1.5 block">
              {{ t("aiObservability.remoteTasks.detail.platformHeadersNote") }}
            </span>
          </RemoteTaskDetailSection>

          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.body')"
            :meta="raw(task.contentType)"
            data-test="ai-remote-task-detail-template"
          >
            <span v-if="!task.requestTemplate" class="text-text-secondary mb-1.5 block text-xs">
              {{ t("aiObservability.remoteTasks.detail.templateDefault") }}
            </span>
            <pre
              class="rounded-default bg-card-bg border-border-default text-text-body m-0 max-h-56 overflow-auto border p-2 font-mono text-xs whitespace-pre-wrap"
              >{{ task.requestTemplate || DEFAULT_REQUEST_TEMPLATE }}</pre>
          </RemoteTaskDetailSection>

          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.contract')"
            data-test="ai-remote-task-detail-contract"
          >
            <dl :class="FIELD_GRID">
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.responsePath") }}</dt>
              <dd class="font-mono">{{ task.responseSchema }}</dd>
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.timeout") }}</dt>
              <dd class="tabular-nums">{{ timeoutLabel }}</dd>
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.attempts") }}</dt>
              <dd class="tabular-nums">{{ task.maxAttempts }}</dd>
              <dt>{{ t("aiObservability.remoteTasks.detail.fields.concurrency") }}</dt>
              <dd class="tabular-nums">{{ task.maxConcurrency }}</dd>
            </dl>
          </RemoteTaskDetailSection>

          <!-- The pinnable reference: the one string another page needs from here. -->
          <RemoteTaskDetailSection
            :title="t('aiObservability.remoteTasks.detail.sections.reference')"
            data-test="ai-remote-task-detail-reference"
          >
            <div v-if="task.taskRef" class="flex flex-wrap items-center gap-2">
              <code class="text-text-body rounded-default bg-card-bg px-2 py-1 font-mono text-xs">
                {{ task.taskRef }}
              </code>
              <OButton
                variant="ghost"
                size="icon-sm"
                :icon-left="refCopied ? 'check' : 'content-copy'"
                :aria-label="t('aiObservability.remoteTasks.detail.copyRef')"
                data-test="ai-remote-task-detail-copy-ref"
                @click="copyRef"
              />
              <span class="text-text-secondary text-2xs">
                {{ t("aiObservability.remoteTasks.detail.taskRefHint") }}
              </span>
            </div>
            <span v-else class="text-text-secondary text-xs">
              {{ t("aiObservability.remoteTasks.detail.taskRefNone") }}
            </span>
          </RemoteTaskDetailSection>

          <p
            v-if="task.verificationError"
            class="border-status-error-text rounded-default bg-surface-base text-status-error-text m-0 border px-4 py-3 text-xs leading-relaxed"
            data-test="ai-remote-task-detail-verification-error"
          >
            {{ t("aiObservability.remoteTasks.detail.verificationError") }}:
            {{ task.verificationError }}
          </p>

          <section
            class="card-container rounded-default border-border-default bg-surface-base border px-4 py-3.5"
          >
            <RemoteTaskTestRunPanel
              :org-id="orgId"
              :entity-id="entityId"
              :can-run="!task.isDraft && task.isReferenceable"
              :max-attempts="task.maxAttempts"
            />
          </section>
        </template>

        <template v-else-if="currentTab === 'versions'">
          <div v-if="hasDraft" class="flex items-center justify-end">
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="delete"
              data-test="ai-remote-task-detail-discard-draft"
              @click="discardDraft"
            >
              {{ t("aiObservability.remoteTasks.detail.discardDraft") }}
            </OButton>
          </div>
          <div class="card-container flex min-h-0 flex-1 flex-col overflow-hidden">
            <OTable
              :data="versions"
              :columns="versionColumns"
              row-key="id"
              :loading="loading"
              :frame="false"
              :show-global-filter="false"
              :page-size="20"
              width="100%"
              class="h-full w-full"
              data-test="ai-remote-task-detail-versions-table"
            >
              <template #cell-version="{ row }">
                <span v-if="!row.isDraft" class="tabular-nums">{{ versionLabel(row) }}</span>
                <span v-else class="text-text-secondary">{{ DASH }}</span>
              </template>
              <template #cell-state="{ row }">
                <OTag type="remoteTaskStatus" :value="rowState(row)" />
              </template>
              <template #cell-taskRef="{ row }">
                <code v-if="row.taskRef" class="text-text-body font-mono text-xs">
                  {{ row.taskRef }}
                </code>
                <span v-else class="text-text-secondary">{{ DASH }}</span>
              </template>
              <template #cell-endpoint="{ row }">
                <span class="text-text-secondary line-clamp-1 font-mono text-xs">
                  {{ row.endpoint }}
                </span>
              </template>
              <template #cell-verifiedAt="{ row }">
                <OTimeCell
                  :value="row.verifiedAt ?? null"
                  unit="ms"
                  mode="relative"
                  :empty-label="DASH"
                />
              </template>
            </OTable>
          </div>
        </template>

        <template v-else-if="currentTab === 'usedBy'">
          <p
            v-if="!usedBy.length"
            class="text-text-secondary border-border-default rounded-default bg-surface-base m-0 border px-4 py-3 text-xs"
            data-test="ai-remote-task-detail-used-by-empty"
          >
            {{ t("aiObservability.remoteTasks.detail.usedByEmpty") }}
          </p>
          <div v-else class="card-container flex min-h-0 flex-1 flex-col overflow-hidden">
            <OTable
              :data="usedBy"
              :columns="usedByColumns"
              row-key="id"
              :loading="loadingUsedBy"
              :frame="false"
              :show-global-filter="false"
              :page-size="20"
              width="100%"
              class="h-full w-full"
              data-test="ai-remote-task-detail-used-by-table"
              @row-click="openExperiment"
            >
              <template #cell-pinnedVersion="{ row }">
                <code class="text-text-body font-mono text-xs">{{ row.pinnedVersion }}</code>
              </template>
              <template #cell-status="{ row }">
                <OTag type="queryStatus" :value="row.status" />
              </template>
              <template #cell-createdAt="{ row }">
                <OTimeCell :value="row.createdAt" unit="ms" mode="relative" :empty-label="DASH" />
              </template>
            </OTable>
          </div>
        </template>

        <section
          v-else
          class="card-container rounded-default border-border-default bg-surface-base border px-4 py-3.5"
        >
          <RemoteTaskSigningPanel
            :org-id="orgId"
            :entity-id="entityId"
            :enabled="task.signing.enabled"
          />
        </section>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import remoteTasksService, { type RemoteTask } from "@/services/remote-tasks.service";
import RemoteTaskSigningPanel from "@/enterprise/components/AIObservability/RemoteTaskSigningPanel.vue";
import RemoteTaskTestRunPanel from "@/enterprise/components/AIObservability/RemoteTaskTestRunPanel.vue";
import RemoteTaskDetailSection from "@/enterprise/components/AIObservability/RemoteTaskDetailSection.vue";
import llmExperimentsService, { type LlmExperiment } from "@/services/llm-experiments.service";
import { aiExperimentDetailRoute } from "./experimentRoutes";
import {
  DEFAULT_REQUEST_TEMPLATE,
  canEditRemoteTask,
  remoteTaskState,
  remoteTaskVersionLabel,
} from "@/enterprise/components/AIObservability/remoteTaskContent";
import { aiRemoteTaskEditRoute, aiRemoteTasksRoute } from "./remoteTaskRoutes";

defineOptions({ name: "AIRemoteTaskDetailPage" });

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const { confirm } = useConfirmDialog();

const DASH = raw("—");
const separator = raw("·");
const signatureHeaderName = raw("x-o2-signature");

/** One definition-list layout, applied once per block rather than on every row. */
const FIELD_GRID =
  "text-text-secondary m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs " +
  "[&>dt]:font-medium [&>dd]:m-0 [&>dd]:text-text-body";

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const entityId = computed<string>(() => String(route.params.id ?? ""));

const task = ref<RemoteTask | null>(null);
const versions = ref<RemoteTask[]>([]);
const loading = ref(false);
const refCopied = ref(false);
const currentTab = ref<"configuration" | "versions" | "usedBy" | "signing">("configuration");

const title = computed<I18nText>(() =>
  task.value ? raw(task.value.name) : t("aiObservability.nav.remoteTasks"),
);
const state = computed(() => (task.value ? remoteTaskState(task.value) : "draft"));
const canEdit = computed(() => Boolean(task.value && canEditRemoteTask(task.value)));
const hasDraft = computed(() => versions.value.some((version) => version.isDraft));
const timeoutLabel = computed<I18nText>(() =>
  task.value ? raw(`${Math.round(task.value.timeoutMs / 1000)} s`) : DASH,
);

/**
 * Only what the API can answer. Run counts, success rate, and latency
 * percentiles need a per-task aggregate that does not exist — see the backend
 * ask in the design doc — and a mislabelled number is worse than none.
 */
const stats = computed<StatItem[]>(() => [
  {
    key: "usedBy",
    label: t("aiObservability.remoteTasks.detail.stats.usedBy"),
    sub: t("aiObservability.remoteTasks.detail.stats.usedBySub"),
    value: usedBy.value.length,
    icon: "science",
    tone: usedBy.value.length ? "info" : "neutral",
    dataTest: "ai-remote-task-detail-stat-used-by",
  },
  {
    key: "versions",
    label: t("aiObservability.remoteTasks.detail.stats.versions"),
    sub: t("aiObservability.remoteTasks.detail.stats.versionsSub"),
    value: versions.value.filter((version) => !version.isDraft).length,
    icon: "history",
    tone: "neutral",
    dataTest: "ai-remote-task-detail-stat-versions",
  },
  {
    key: "lastVerified",
    label: t("aiObservability.remoteTasks.detail.stats.lastVerified"),
    sub: t("aiObservability.remoteTasks.detail.stats.lastVerifiedSub"),
    value: lastVerifiedLabel.value,
    icon: "check",
    tone: task.value?.verifiedAt ? "success" : "neutral",
    dataTest: "ai-remote-task-detail-stat-verified",
  },
]);

const lastVerifiedLabel = computed<string>(() => {
  const at = task.value?.verifiedAt;
  if (!at) return String(t("aiObservability.remoteTasks.detail.stats.never"));
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  return hours >= 1 ? `${hours}h` : `<1h`;
});

// Which experiments pin this task, derived the same way the list page derives
// its count — `task_ref` carries a name, never an id, so the match is by name.
const usedBy = ref<
  { id: string; name: string; pinnedVersion: string; status: string; createdAt: number }[]
>([]);
const loadingUsedBy = ref(false);

const usedByColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "name",
    header: t("aiObservability.remoteTasks.detail.usedByColumns.name"),
    accessorKey: "name",
    sortable: false,
    size: 280,
    meta: { align: "left", flex: true },
  },
  {
    id: "pinnedVersion",
    header: t("aiObservability.remoteTasks.detail.usedByColumns.version"),
    accessorKey: "pinnedVersion",
    sortable: false,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("aiObservability.remoteTasks.detail.usedByColumns.status"),
    accessorKey: "status",
    sortable: false,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "createdAt",
    header: t("aiObservability.remoteTasks.detail.usedByColumns.created"),
    accessorKey: "createdAt",
    sortable: false,
    size: 160,
    meta: { align: "left" },
  },
]);

function openExperiment(row: { id: string }) {
  void router.push(aiExperimentDetailRoute(orgId.value, row.id));
}

/** Best-effort: an unreachable experiments list must not blank the task page. */
async function loadUsedBy(name: string) {
  loadingUsedBy.value = true;
  try {
    const experiments: LlmExperiment[] = await llmExperimentsService.list(orgId.value);
    usedBy.value = experiments
      .filter(
        (experiment) =>
          experiment.task?.type === "remote" &&
          String(experiment.task.taskRef ?? "").split("@")[0] === name,
      )
      .map((experiment) => ({
        id: experiment.id,
        name: experiment.name,
        pinnedVersion: String(experiment.task.type === "remote" ? experiment.task.taskRef : ""),
        status: experiment.status,
        createdAt: experiment.createdAt,
      }));
  } catch {
    usedBy.value = [];
  } finally {
    loadingUsedBy.value = false;
  }
}

const versionLabel = (row: RemoteTask) => remoteTaskVersionLabel(row);
const rowState = (row: RemoteTask) => remoteTaskState(row);

const versionColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "version",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.version"),
    accessorKey: "version",
    sortable: false,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "state",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.status"),
    accessorFn: (row: RemoteTask) => remoteTaskState(row),
    sortable: false,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "taskRef",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.reference"),
    accessorKey: "taskRef",
    sortable: false,
    size: 220,
    meta: { align: "left" },
  },
  {
    id: "endpoint",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.endpoint"),
    accessorKey: "endpoint",
    sortable: false,
    size: 300,
    meta: { align: "left", flex: true },
  },
  {
    id: "verifiedAt",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.verifiedAt"),
    accessorKey: "verifiedAt",
    sortable: false,
    size: 160,
    meta: { align: "left" },
  },
]);

function goBack() {
  void router.push(aiRemoteTasksRoute(orgId.value));
}

function openEdit() {
  if (!canEdit.value) return;
  void router.push(aiRemoteTaskEditRoute(orgId.value, entityId.value));
}

async function copyRef() {
  if (!task.value?.taskRef) return;
  try {
    await navigator.clipboard.writeText(task.value.taskRef);
    refCopied.value = true;
  } catch {
    refCopied.value = false;
  }
}

async function refresh() {
  if (!orgId.value || !entityId.value) return;
  loading.value = true;
  try {
    const [head, allVersions] = await Promise.all([
      remoteTasksService.get(orgId.value, entityId.value),
      remoteTasksService.versions(orgId.value, entityId.value),
    ]);
    task.value = head;
    versions.value = allVersions;
    void loadUsedBy(head.name);
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.detail.loadError"),
    });
  } finally {
    loading.value = false;
  }
}

async function discardDraft() {
  const ok = await confirm({
    title: t("aiObservability.remoteTasks.detail.discardDraftTitle"),
    message: t("aiObservability.remoteTasks.detail.discardDraftMessage"),
    confirmLabel: t("aiObservability.remoteTasks.detail.discardDraft"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  try {
    await remoteTasksService.discardDraft(orgId.value, entityId.value);
    toast({
      variant: "success",
      message: t("aiObservability.remoteTasks.detail.discardDraftSuccess"),
    });
    await refresh();
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) ||
        t("aiObservability.remoteTasks.detail.discardDraftError"),
    });
  }
}

onMounted(refresh);
</script>
