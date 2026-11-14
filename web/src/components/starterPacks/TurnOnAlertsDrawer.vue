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
import { computed, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import AddDestination from "@/components/alerts/AddDestination.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { readQuery } from "@/composables/query/readQuery";
import { packScopeValue } from "@/composables/starterPacks/packCopy";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useTurnOnAlerts, type TurnOnRow } from "@/composables/starterPacks/useTurnOnAlerts";
import {
  isNoisy,
  isPartlyChecked,
  queriesPerDay,
  type AlertSeverity,
} from "@/composables/starterPacks/wouldFire";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { templatesQuery } from "@/services/alert_templates.queries";
import { routingConfigQuery, escalationPreviewQuery } from "@/services/oncall.queries";
import { priorityForSeverity } from "@/constants/alertLibrary";
import type { Template } from "@/ts/interfaces";
import type { EscalationPreview } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { makeTurnOnSchema, turnOnDefaults } from "./TurnOnAlertsDrawer.schema";

const props = defineProps<{ flow: StarterPackFlow; clusters: string[] }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ done: [count: number] }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const org = store.state.selectedOrganization?.identifier as string;
const turn = useTurnOnAlerts(org, props.flow);

const expanded = ref<string | null>(null);
const editing = ref<string | null>(null);
const thresholdDraft = ref<string | number>("");
const limitOpen = ref(false);
const limitTo = ref<string[]>([]);
const addingDestination = ref(false);
const lastChoice = ref({ critical: "", warning: "" });

const destinations = shallowRef<Array<{ name: string }>>([]);
const templates = shallowRef<Template[]>([]);
const destinationOptions = computed(() =>
  destinations.value.map(({ name }) => ({ label: raw(name), value: name })),
);

const enterprise = computed(
  () => store.state.zoConfig?.build_type !== "opensource" && config.isEnterprise === "true",
);
const oncallChecked = ref(false);
const teamId = ref("");
const oncallRows = shallowRef<Array<{ key: AlertSeverity; preview: EscalationPreview | null }>>([]);
const readDestinations = async (force = false) => {
  destinations.value = await readQuery(destinationsQuery(org, "alert"), force).catch(() => []);
};
const readTemplates = async () => {
  templates.value = await readQuery(templatesQuery(org)).catch(() => []);
};
const readOncall = async () => {
  oncallChecked.value = false;
  const routing = await readQuery(routingConfigQuery(org)).catch(() => null);
  teamId.value = routing?.default_team_id ?? "";
  oncallRows.value = teamId.value
    ? await Promise.all(
        (["critical", "warning"] as const).map(async (key) => {
          const priority = priorityForSeverity(key) ?? undefined;
          const query = escalationPreviewQuery(org, teamId.value, priority);
          return { key, preview: await readQuery(query).catch(() => null) };
        }),
      )
    : [];
  oncallChecked.value = true;
};

const form = useOForm({
  defaultValues: turnOnDefaults(),
  schema: makeTurnOnSchema(t, {
    critical: () => turn.needsCritical.value,
    warning: () => turn.needsWarning.value,
  }),
  onSubmit: (values) => submit(values),
});

const offRows = computed(() => turn.rows.value.filter(({ enabled }) => !enabled));
const longest = computed(() =>
  Math.max(0, ...offRows.value.map((row) => row.result?.checkedSeconds ?? 0)),
);
const checkedCount = computed(
  () => offRows.value.filter(({ state }) => state !== "loading").length,
);
const stillChecking = computed(() => checkedCount.value < offRows.value.length);
const allNoData = computed(
  () =>
    !stillChecking.value &&
    offRows.value.length > 0 &&
    offRows.value.every(({ result }) => result?.noData),
);
const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes < 120
    ? t("starterPacks.turnOn.minutes", { count: minutes })
    : t("starterPacks.turnOn.hours", { count: Math.floor(minutes / 60) });
};
const headline = computed(() => {
  const { incidents, checkedSeconds, lowConfidence } = turn.summary.value;
  const alerts = turn.chosenRows.value.length;
  const values = { alerts, incidents, window: duration(checkedSeconds) };
  return t(
    lowConfidence ? "starterPacks.turnOn.headlineSoFar" : "starterPacks.turnOn.headlineDay",
    values,
    incidents,
  );
});
const leftOff = computed(() => turn.summary.value.leftOffIncidents);
const leftOffNames = computed(() =>
  offRows.value
    .filter(({ chosen }) => !chosen)
    .map(({ name }) => name)
    .join(raw(", ")),
);
const scope = computed(() =>
  limitTo.value.length
    ? t("starterPacks.turnOn.limited", { count: limitTo.value.length }, limitTo.value.length)
    : packScopeValue(t, props.clusters),
);
const cost = computed(() =>
  t("starterPacks.turnOn.cost", {
    queries: queriesPerDay(turn.chosenRows.value.map(({ alert }) => alert)).toLocaleString(),
    checks: offRows.value.length,
  }),
);
const history = (row: TurnOnRow) =>
  row.result && longest.value > row.result.checkedSeconds * 1.1
    ? t("starterPacks.turnOn.partOf", {
        part: Math.round(row.result.checkedSeconds / 60),
        whole: duration(longest.value),
      })
    : duration(row.result?.checkedSeconds ?? 0);
const failedNames = computed(() =>
  turn.rows.value
    .filter(({ id }) => turn.failedIds.value.includes(id))
    .map(({ name }) => name)
    .join(raw(", ")),
);
const conditionOf = ({ alert }: TurnOnRow) => {
  const condition = alert.query_condition ?? {};
  return condition.type === "promql"
    ? `${condition.promql_condition?.operator} ${condition.promql_condition?.value}`
    : `${alert.trigger_condition?.operator} ${alert.trigger_condition?.threshold}`;
};
const thresholdOf = ({ alert }: TurnOnRow) =>
  alert.query_condition?.type === "promql"
    ? alert.query_condition.promql_condition?.value
    : alert.trigger_condition?.threshold;
const queryOf = ({ alert }: TurnOnRow) =>
  alert.query_condition?.promql ?? alert.query_condition?.sql ?? "";

const startEdit = (row: TurnOnRow) => {
  editing.value = row.id;
  thresholdDraft.value = thresholdOf(row);
};
const saveThreshold = async (row: TurnOnRow) => {
  const value = Number(thresholdDraft.value);
  if (!Number.isFinite(value)) return;
  if (await turn.setThreshold(row.id, value)) editing.value = null;
};
const setLimit = (cluster: string, on: boolean) => {
  limitTo.value = on
    ? [...limitTo.value, cluster]
    : limitTo.value.filter((name) => name !== cluster);
};

async function submit(values: { critical: string; warning: string }, onlyIds?: string[]) {
  lastChoice.value = values;
  const count = await turn.turnOn({ ...values, clusters: limitTo.value }, onlyIds);
  if (count && !turn.failedIds.value.length) {
    open.value = false;
    emit("done", count);
  }
}
const retryFailed = () => submit(lastChoice.value, turn.failedIds.value);
const destinationAdded = async () => {
  await readDestinations(true);
  addingDestination.value = false;
};
const collectorRoute = props.flow.pack.collectorRoute;
const collector = () =>
  router.push({ name: collectorRoute, query: { org_identifier: org } }).catch(() => {});
const copyLink = () => copyToClipboard(props.flow.packLink(), t);

watch(addingDestination, (adding) => adding && void readTemplates());
watch(open, (isOpen) => {
  if (!isOpen) return;
  void turn.load();
  void readDestinations();
  if (enterprise.value) void readOncall();
});
</script>

<template>
  <ODrawer
    v-model:open="open"
    size="md"
    :title="t('starterPacks.turnOn.title', { title: t(flow.pack.titleKey) })"
    data-test="turn-on-alerts"
  >
    <OForm id="turn-on-alerts-form" :form="form" class="flex flex-col gap-3 p-3 text-sm">
      <div
        v-if="turn.loadState.value === 'loading' || stillChecking"
        class="flex flex-col gap-2"
        data-test="turn-on-alerts-checking"
      >
        <span>{{
          t("starterPacks.turnOn.checking", {
            done: checkedCount,
            total: offRows.length,
          })
        }}</span>
        <OSkeleton class="h-4 w-full" />
      </div>
      <OBanner v-else-if="turn.loadState.value === 'error'" variant="default" dense inline-actions>
        {{ t("starterPacks.turnOn.loadFailed") }}
        <template #actions>
          <OButton variant="outline" size="sm-action" @click="turn.load()">
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
      <template v-else-if="allNoData">
        <p data-test="turn-on-alerts-summary">
          {{ t("starterPacks.turnOn.noDataYet") }}
          <OButton
            v-if="collectorRoute"
            variant="ghost-primary"
            size="sm-action"
            data-test="turn-on-alerts-check-collector-link"
            @click="collector"
          >
            {{ t("starterPacks.health.checkCollector") }}
          </OButton>
        </p>
      </template>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <strong data-test="turn-on-alerts-summary">{{ headline }}</strong>
          <OBadge
            v-if="turn.summary.value.lowConfidence"
            variant="default"
            data-test="turn-on-alerts-low-confidence-tag"
          >
            {{ t("starterPacks.turnOn.lowConfidence") }}
          </OBadge>
        </div>
        <span v-if="leftOffNames" data-test="turn-on-alerts-left-off">{{
          t("starterPacks.turnOn.leftOff", { names: leftOffNames, count: leftOff }, leftOff)
        }}</span>
      </template>
      <div class="border-border-default rounded-default border" data-test="turn-on-alerts-table">
        <div
          v-for="row in offRows"
          :key="row.id"
          class="border-border-default border-b last:border-b-0"
          :data-test="`turn-on-alerts-row-${row.id}`"
        >
          <div class="flex items-center gap-2 px-2 py-1.5">
            <OCheckbox
              :model-value="row.chosen"
              :aria-label="row.name"
              :data-test="`turn-on-alerts-check-${row.id}`"
              @update:model-value="turn.choose(row.id, !!$event)"
            />
            <OButton
              variant="ghost"
              size="icon-xs"
              :aria-label="t('starterPacks.turnOn.expand')"
              data-test="turn-on-alerts-row-expand"
              @click="expanded = expanded === row.id ? null : row.id"
            >
              <OIcon :name="expanded === row.id ? 'expand-more' : 'chevron-right'" size="sm" />
            </OButton>
            <span class="flex min-w-0 flex-1 items-center gap-2">
              <OTruncatedText class="text-text-heading font-medium">{{ row.name }}</OTruncatedText>
              <OBadge :variant="row.severity === 'critical' ? 'error-soft' : 'warning-soft'">
                {{ t(`starterPacks.severity.${row.severity}`) }}
              </OBadge>
            </span>
            <OSkeleton v-if="row.state === 'loading'" class="h-4 w-20" />
            <span v-else-if="row.state === 'error'" class="flex items-center gap-2">
              {{ t("starterPacks.turnOn.rowFailed") }}
              <OButton
                variant="outline"
                size="sm-action"
                data-test="turn-on-alerts-row-retry-btn"
                @click="turn.retryRow(row.id)"
              >
                {{ t("common.retry") }}
              </OButton>
            </span>
            <OBadge
              v-else-if="row.result?.noData"
              variant="default"
              data-test="turn-on-alerts-no-data-tag"
            >
              {{ t("starterPacks.turnOn.noData") }}
            </OBadge>
            <span v-else class="flex flex-wrap items-center justify-end gap-1">
              <OText>{{
                t(
                  "starterPacks.turnOn.incidents",
                  { count: row.result?.incidents ?? 0 },
                  row.result?.incidents ?? 0,
                )
              }}</OText>
              <OText v-if="row.result?.runs" variant="meta"
                >{{ raw("· ") }}{{ history(row) }}{{ raw(" · ")
                }}{{
                  t("starterPacks.turnOn.runs", { count: row.result.runs }, row.result.runs)
                }}</OText
              >
              <OText
                v-if="isNoisy(row.result) && !row.chosen"
                variant="meta"
                data-test="turn-on-alerts-noisy-tag"
                >{{ raw("· ") }}{{ t("starterPacks.turnOn.noisy") }}</OText
              >
              <OBadge
                v-if="isPartlyChecked(row.result, longest)"
                variant="default"
                data-test="turn-on-alerts-partial-tag"
              >
                {{ t("starterPacks.turnOn.partly") }}
              </OBadge>
            </span>
          </div>
          <div
            v-if="expanded === row.id"
            class="bg-surface-subtle grid grid-cols-[6rem_minmax(0,1fr)] gap-1 px-10 py-2 text-xs"
            data-test="turn-on-alerts-row-detail"
          >
            <span>{{ t("starterPacks.turnOn.condition") }}</span>
            <span class="flex flex-wrap items-center gap-2">
              <code>{{ conditionOf(row) }}</code>
              <template v-if="editing === row.id">
                <OInput
                  v-model="thresholdDraft"
                  type="number"
                  size="sm"
                  class="w-20"
                  :aria-label="t('starterPacks.turnOn.editThreshold')"
                  data-test="turn-on-alerts-threshold-input"
                />
                <OButton
                  variant="outline"
                  size="sm-action"
                  data-test="turn-on-alerts-threshold-save-btn"
                  @click="saveThreshold(row)"
                >
                  {{ t("common.save") }}
                </OButton>
              </template>
              <OButton
                v-else
                variant="ghost-primary"
                size="sm-action"
                data-test="turn-on-alerts-edit-threshold-btn"
                @click="startEdit(row)"
              >
                {{ t("starterPacks.turnOn.editThreshold") }}
              </OButton>
            </span>
            <span>{{ t("starterPacks.turnOn.duration") }}</span>
            <span>{{ row.alert.trigger_condition?.period }} min</span>
            <span>{{ t("starterPacks.turnOn.stream") }}</span>
            <code class="break-all">{{ row.alert.stream_name }}</code>
            <span>{{ t("starterPacks.turnOn.query") }}</span>
            <code class="break-all">{{ queryOf(row) }}</code>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex items-end gap-2">
          <OFormSelect
            name="critical"
            class="min-w-0 flex-1"
            :label="t('starterPacks.turnOn.criticalGoTo')"
            :required="turn.needsCritical.value"
            :options="destinationOptions"
            label-key="label"
            value-key="value"
            searchable
            data-test="turn-on-alerts-critical-destination"
          />
          <OButton
            variant="ghost-primary"
            size="sm-action"
            icon-left="add"
            data-test="turn-on-alerts-new-destination-btn"
            @click="addingDestination = !addingDestination"
          >
            {{ t("starterPacks.turnOn.newDestination") }}
          </OButton>
        </div>
        <OText
          v-if="!destinationOptions.length"
          variant="meta"
          data-test="turn-on-alerts-no-destinations"
          >{{ t("starterPacks.turnOn.noDestinations") }}</OText
        >
        <OFormSelect
          name="warning"
          :label="t('starterPacks.turnOn.warningsGoTo')"
          :required="turn.needsWarning.value"
          :options="destinationOptions"
          label-key="label"
          value-key="value"
          searchable
          data-test="turn-on-alerts-warning-destination"
        />
      </div>
      <div
        v-if="addingDestination"
        class="border-border-default rounded-default border p-2"
        data-test="turn-on-alerts-new-destination-types"
      >
        <AddDestination
          :is-alerts="true"
          :templates="templates"
          @get:destinations="destinationAdded"
          @cancel:hideform="addingDestination = false"
        />
      </div>

      <OCollapsible
        :label="t('starterPacks.turnOn.moreDetails')"
        data-test="turn-on-alerts-more-details"
      >
        <div class="flex flex-col gap-3 pt-2">
          <OText variant="meta" data-test="turn-on-alerts-history-note">{{
            t("starterPacks.turnOn.historyNote")
          }}</OText>
          <OText variant="meta" data-test="turn-on-alerts-noise-rule">{{
            t("starterPacks.turnOn.noiseRule")
          }}</OText>
          <div
            class="border-border-default rounded-default flex flex-col gap-1 border p-2"
            data-test="turn-on-alerts-scope"
          >
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <strong>{{ t("starterPacks.turnOn.scopeTitle") }}</strong>
                <p>{{ scope }}</p>
              </div>
              <OButton
                v-if="clusters.length"
                variant="outline"
                size="sm-action"
                data-test="turn-on-alerts-limit-clusters-btn"
                @click="limitOpen = !limitOpen"
              >
                {{ t("starterPacks.turnOn.limit") }}
              </OButton>
            </div>
            <template v-if="limitOpen">
              <OCheckbox
                v-for="cluster in clusters"
                :key="cluster"
                :model-value="limitTo.includes(cluster)"
                :label="raw(cluster)"
                @update:model-value="setLimit(cluster, !!$event)"
              />
              <OText variant="meta">{{ t("starterPacks.turnOn.limitNote") }}</OText>
            </template>
          </div>
          <div
            v-if="enterprise && oncallChecked"
            class="border-border-default rounded-default flex flex-col gap-1 border p-2"
            data-test="turn-on-alerts-oncall-preview"
          >
            <strong>{{ t("starterPacks.turnOn.oncallTitle") }}</strong>
            <template v-if="teamId">
              <template v-for="row in oncallRows" :key="row.key">
                <p v-if="row.preview" :data-test="`turn-on-alerts-oncall-${row.key}`">
                  <OBadge :variant="row.key === 'critical' ? 'error-outline' : 'warning-outline'">
                    {{ t(`starterPacks.severity.${row.key}`) }}
                  </OBadge>
                  {{ row.preview.team_name }}: {{ row.preview.ends_with }}
                </p>
              </template>
            </template>
            <p data-test="turn-on-alerts-oncall-unknown">
              {{ t("starterPacks.turnOn.oncallUnknown") }}
            </p>
          </div>
          <OText variant="meta" data-test="turn-on-alerts-cost">{{ cost }}</OText>
        </div>
      </OCollapsible>

      <OBanner v-if="turn.forbidden.value" variant="default" dense inline-actions icon="lock">
        {{ t("starterPacks.turnOn.forbidden") }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="content-copy"
            data-test="turn-on-alerts-copy-link-btn"
            @click="copyLink"
          >
            {{ t("starterPacks.copyLink") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="turn.failedIds.value.length"
        variant="error-soft"
        dense
        inline-actions
        data-test="turn-on-alerts-failed"
      >
        {{ t("starterPacks.turnOn.partial", { names: failedNames }) }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="turn-on-alerts-retry-btn"
            @click="retryFailed"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
    </OForm>
    <template #footer>
      <div class="flex w-full items-center gap-2">
        <span class="flex-1" />
        <OButton
          variant="outline"
          size="sm-action"
          data-test="turn-on-alerts-cancel-btn"
          @click="open = false"
        >
          {{ t("starterPacks.turnOn.keepSilent") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          form="turn-on-alerts-form"
          :loading="turn.submitting.value"
          :disabled="!turn.chosenRows.value.length"
          data-test="turn-on-alerts-submit-btn"
        >
          {{
            t(
              "starterPacks.turnOn.submit",
              { count: turn.chosenRows.value.length },
              turn.chosenRows.value.length,
            )
          }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>
