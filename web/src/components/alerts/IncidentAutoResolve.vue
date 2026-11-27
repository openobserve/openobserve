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

<!-- The incident's AutoResolve: its one run, the saved AutoResolves of its alerts, and a new run. -->
<template>
  <section
    v-if="enabled && !forbidden"
    data-test="incident-autoresolve"
    :aria-labelledby="headingId"
    class="flex flex-col"
  >
    <div class="mb-2.5 flex flex-wrap items-center gap-2">
      <h3 :id="headingId" class="text-text-heading m-0 text-base font-bold">
        {{ t("autoresolve.incident.title") }}
      </h3>
      <span class="text-text-secondary text-xs">{{ t("autoresolve.incident.note") }}</span>
      <OTooltip
        v-if="incident.data.value && !composing"
        :content="lockedReason"
        :disabled="!live"
        side="left"
      >
        <span class="ms-auto inline-flex">
          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            :disabled="live"
            data-test="incident-autoresolve-new-run"
            @click="openComposer"
          >
            {{ t("autoresolve.incident.newRun") }}
          </OButton>
        </span>
      </OTooltip>
    </div>

    <p
      v-if="incident.isPending.value"
      role="status"
      data-test="incident-autoresolve-loading"
      class="text-text-secondary m-0 flex items-center gap-2 text-sm"
    >
      <OSpinner variant="dots" size="xs" />
      {{ t("autoresolve.incident.loading") }}
    </p>
    <OBanner
      v-else-if="incident.isError.value"
      data-test="incident-autoresolve-load-failed"
      variant="error-soft"
      icon="error"
      role="alert"
      inline-actions
    >
      <p class="text-banner-error-soft-text m-0 text-sm font-semibold">
        {{ t("autoresolve.incident.loadFailed") }}
      </p>
      <template #actions>
        <OButton
          data-test="incident-autoresolve-retry"
          variant="outline"
          size="sm"
          icon-left="refresh"
          @click="incident.refetch()"
        >
          {{ t("common.retry") }}
        </OButton>
      </template>
    </OBanner>

    <div v-else class="flex flex-col gap-3">
      <OInlineNotice
        v-if="startError && !composing"
        variant="error"
        wrap
        :text="startError"
        data-test="incident-autoresolve-error"
      />

      <div
        v-if="run"
        data-test="incident-autoresolve-run"
        class="rounded-default border-border-default bg-surface-base flex items-start gap-3 border px-3 py-2.5"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <OTag type="autoresolveRunState" :value="run.state" size="sm" />
            <span class="text-text-heading text-sm font-semibold wrap-anywhere">
              {{ run.name || run.goal }}
            </span>
          </div>
          <p v-if="run.name" class="text-text-secondary text-compact m-0 wrap-anywhere">
            {{ run.goal }}
          </p>
          <p class="text-text-secondary m-0 text-xs">{{ run.trigger.label }}</p>
          <p v-if="live" class="text-text-body m-0 text-xs" data-test="incident-autoresolve-live">
            {{ t("autoresolve.incident.liveRun") }}
          </p>
        </div>
        <OButton
          variant="ghost-primary"
          size="sm"
          icon-right="arrow-forward"
          class="shrink-0"
          data-test="incident-autoresolve-open-run"
          @click="openRun(run.run_id)"
        >
          {{ t("autoresolve.incident.openRun") }}
        </OButton>
      </div>

      <div v-if="related.length" class="flex flex-col gap-1.5">
        <h4 :id="relatedId" class="text-text-secondary m-0 text-xs font-semibold">
          {{ t("autoresolve.incident.related") }}
        </h4>
        <ol
          :aria-labelledby="relatedId"
          class="rounded-default border-border-default bg-surface-base divide-border-default m-0 list-none divide-y border p-0"
        >
          <li
            v-for="item in related"
            :key="item.id"
            data-test="incident-autoresolve-related"
            class="flex items-start gap-3 px-3 py-2.5"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="text-text-heading text-sm font-semibold wrap-anywhere">
                  {{ item.name }}
                </span>
                <span
                  class="text-text-secondary text-xs"
                  data-test="incident-autoresolve-related-kind"
                >
                  {{ kindLabel(item) }}
                </span>
              </div>
              <p class="text-text-secondary text-compact m-0 wrap-anywhere">{{ item.goal }}</p>
              <p v-if="item.connections.length" class="text-text-secondary m-0 text-xs">
                {{ connectionsSentence(item.connections, t) }}
              </p>
            </div>
            <OTooltip :content="lockedReason" :disabled="!live" side="left">
              <span class="inline-flex shrink-0">
                <OButton
                  variant="outline"
                  size="sm"
                  icon-left="play-arrow"
                  :disabled="live || (runSaved.isPending.value && runningId !== item.id)"
                  :loading="runningId === item.id"
                  :data-test="`incident-autoresolve-run-${item.id}`"
                  @click="runRelated(item.id)"
                >
                  {{ t("autoresolve.incident.run") }}
                </OButton>
              </span>
            </OTooltip>
          </li>
        </ol>
      </div>

      <p
        v-if="!run && !related.length && !composing"
        data-test="incident-autoresolve-empty"
        class="text-text-secondary text-compact m-0"
      >
        {{ t("autoresolve.incident.empty") }}
      </p>

      <div v-if="composing" class="flex flex-col gap-2" data-test="incident-autoresolve-composer">
        <OInlineNotice
          v-if="mcps.isError.value"
          variant="error"
          wrap
          :text="t('emptyState.loadError.description')"
        />
        <AutoResolveGoalBox
          v-else
          v-model="goal"
          v-model:connection-ids="connectionIds"
          :connections="connections"
          :max-connections="maxConnections"
          :starting="startRun.isPending.value"
          :loading="summary.isPending.value || mcps.isPending.value"
          :error="startError"
          :can-add-mcps="mcps.data.value?.canCreate === true"
          cancellable
          @start="onStart"
          @edit="startError = null"
          @cancel="composing = false"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AutoResolveGoalBox from "@/components/autoresolve/AutoResolveGoalBox.vue";
import {
  autoresolveErrorMessage,
  autoresolveErrorStatus,
  DEFAULT_MAX_CONNECTIONS,
  isForbidden,
  type AutoResolveIncidentRelated,
} from "@/services/autoresolve";
import {
  autoresolveIncidentQuery,
  autoresolveSummaryQuery,
  runAutoResolveSavedMutation,
  startAutoResolveRunMutation,
} from "@/services/autoresolve.queries";
import { mcpToolsetsQuery } from "@/services/ai_toolsets.queries";
import productAnalytics from "@/services/product_analytics";
import { connectionsSentence } from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{ orgId: string; incidentId: string }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const headingId = useId();
const relatedId = useId();

// The MCP form's gate: `autoresolve_enabled` already folds in the licence and the deployment flag.
const enabled = computed(
  () => config.isEnterprise == "true" && store.state.zoConfig?.autoresolve_enabled === true,
);

const incident = useQuery(() =>
  Object.assign(autoresolveIncidentQuery(props.orgId, props.incidentId), {
    enabled: enabled.value && !!props.orgId && !!props.incidentId,
  }),
);
// Someone who may not use AutoResolve sees no section at all.
const forbidden = computed(() => isForbidden(incident.error.value));
const run = computed(() => incident.data.value?.run ?? null);
const related = computed(() => incident.data.value?.related ?? []);
const live = computed(() => run.value?.live === true);
const lockedReason = computed(() =>
  run.value?.live
    ? t("autoresolve.incident.runLocked", { run: raw(run.value.name || run.value.goal) })
    : undefined,
);

const kindLabel = (item: AutoResolveIncidentRelated): I18nText => {
  const alert = raw(item.alert_name ?? item.alert_id);
  if (item.trigger_kind === "incident") return t("autoresolve.incident.suggestedFor", { alert });
  if (item.trigger_kind === "alert") return t("autoresolve.incident.startsOn", { alert });
  return t("autoresolve.saved.kind.person");
};

const openRun = (id: string) =>
  void router.push({
    name: "autoresolveRun",
    params: { id },
    query: { org_identifier: props.orgId },
  });

// The new-run box reads the MCPs only once it opens.
const composing = ref(false);
const goal = ref("");
const connectionIds = ref<string[]>([]);
const summary = useQuery(() =>
  Object.assign(autoresolveSummaryQuery(props.orgId), { enabled: composing.value }),
);
const mcps = useQuery(() =>
  Object.assign(mcpToolsetsQuery(props.orgId), { enabled: composing.value }),
);
const connections = computed(() => mcps.data.value?.mcps ?? []);
const maxConnections = computed(
  () => summary.data.value?.max_connections || DEFAULT_MAX_CONNECTIONS,
);
const startRun = useMutation(() => startAutoResolveRunMutation(props.orgId));

const startError = ref<I18nText | null>(null);
const started =
  (source: string) =>
  ({ run_id }: { run_id: string }) => {
    productAnalytics.track("autoresolve_run_started", { source });
    openRun(run_id);
  };
// A 409 names the incident's live run: say it and read the incident again so the page shows it.
const refused = (error: unknown) => {
  startError.value = raw(autoresolveErrorMessage(error)) || t("autoresolve.home.startFailed");
  const status = autoresolveErrorStatus(error);
  if (status === 409) {
    composing.value = false;
    void incident.refetch();
  } else if (status === 400 && composing.value) {
    // A refused choice may name a connection removed since the list was read.
    void mcps.refetch();
  }
};

const runSaved = useMutation(() => runAutoResolveSavedMutation(props.orgId, props.incidentId));
const runningId = computed(() => (runSaved.isPending.value ? runSaved.variables.value : null));
const runRelated = (id: string) => {
  startError.value = null;
  runSaved.mutate(id, { onSuccess: started("incident_saved"), onError: refused });
};

const openComposer = () => {
  // A draft the person wrote survives a cancel; otherwise start from the RCA's probable cause.
  goal.value ||= incident.data.value?.suggested_goal ?? "";
  startError.value = null;
  composing.value = true;
};

const onStart = (v: { goal: string; connectionIds: string[] }) => {
  startError.value = null;
  startRun.mutate(
    { goal: v.goal, connection_ids: v.connectionIds, incident_id: props.incidentId },
    { onSuccess: started("incident"), onError: refused },
  );
};
</script>
