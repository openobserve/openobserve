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
    class="composite-term-card card-container border border-border-default rounded-md"
    :data-test="`composite-term-card-${term.name}`"
  >
    <!-- Header: collapse + alias + mode toggle + remove -->
    <div
      class="flex items-center gap-3 px-3 py-2 flex-wrap"
      :class="collapsed ? '' : 'border-b border-border-default'"
    >
      <button
        type="button"
        class="shrink-0 cursor-pointer text-text-secondary hover:text-text-primary flex items-center"
        :data-test="`composite-term-${term.name}-collapse`"
        @click="collapsed = !collapsed"
      >
        <OIcon :name="collapsed ? 'chevron-right' : 'expand-more'" size="sm" />
      </button>

      <div class="flex items-center gap-1.5">
        <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.alias") }} <span class="text-text-primary">*</span></span>
        <OInput
          :model-value="term.name"
          placeholder="A"
          class="w-[90px] h-[28px]! min-h-[28px]!"
          :data-test="`composite-term-${term.name}-alias`"
          @update:model-value="onAliasInput"
        />
      </div>

      <OToggleGroup
        :model-value="term.mode"
        :disabled="locked"
        @update:model-value="(val) => onModeChange(val as string)"
      >
        <OToggleGroupItem value="existing" size="sm" :data-test="`composite-term-${term.name}-mode-existing`">
          {{ t("alerts.composite.useExisting") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="new" size="sm" :data-test="`composite-term-${term.name}-mode-new`">
          {{ t("alerts.composite.createNew") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <!-- Compact summary when collapsed -->
      <span
        v-if="collapsed"
        class="text-xs text-text-secondary truncate max-w-[280px]"
        :title="collapsedSummary"
      >
        {{ collapsedSummary }}
      </span>

      <div class="flex-1" />

      <OButton
        v-if="canRemove"
        variant="ghost-destructive"
        size="xs"
        icon-left="delete"
        :data-test="`composite-term-${term.name}-remove`"
        @click="$emit('remove')"
      >
        {{ t("alerts.composite.removeTerm") }}
      </OButton>
    </div>

    <div v-show="!collapsed">
    <!-- Existing: pick an alert from this folder -->
    <div v-if="term.mode === 'existing'" class="px-3 py-2.5 flex flex-col gap-2">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.memberAlert") }} <span class="text-text-primary">*</span></span>
        <OSelect
          :model-value="term.alert_id"
          :options="memberOptions"
          :loading="loadingMembers"
          searchable
          :placeholder="t('alerts.composite.selectMember')"
          class="flex-1 min-w-[220px] h-[28px]! min-h-[28px]!"
          :data-test="`composite-term-${term.name}-member`"
          @update:model-value="onMemberSelect"
        />
      </div>

      <!-- Selected member: plain-English trigger description + edit link -->
      <div
        v-if="selectedMember"
        class="flex items-center gap-2 text-xs text-text-secondary pl-1"
        :data-test="`composite-term-${term.name}-member-summary`"
      >
        <OIcon name="info" size="xs" class="shrink-0" />
        <span class="min-w-0">
          {{ t("alerts.composite.memberTriggersWhen") }}
          <span class="text-text-primary font-medium">{{ operatorText }} {{ selectedMember.threshold }}</span>
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="flex items-center gap-1 text-[var(--q-primary)] hover:underline cursor-pointer shrink-0"
          :data-test="`composite-term-${term.name}-open-member`"
          @click="$emit('open-member', term.alert_id)"
        >
          {{ t("alerts.composite.editMember") }}
          <OIcon name="open-in-new" size="xs" />
        </button>
      </div>
    </div>

    <!-- New: build the query (destination/schedule/name inherited from composite) -->
    <template v-else>
      <div class="flex items-center gap-4 px-3 py-2 flex-wrap">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.streamType") }} <span class="text-text-primary">*</span></span>
          <OSelect
            :model-value="term.draft.stream_type"
            :options="streamTypes"
            :searchable="false"
            :disabled="locked"
            class="h-[28px]! min-h-[28px]!"
            @update:model-value="onStreamTypeChange"
          />
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.stream_name") }} <span class="text-text-primary">*</span></span>
          <OSelect
            :model-value="term.draft.stream_name"
            :options="streamNameOptions"
            :loading="isFetchingStreams"
            :disabled="locked || !term.draft.stream_type"
            class="h-[28px]! min-h-[28px]! min-w-[160px]"
            @update:model-value="onStreamNameChange"
          />
        </div>
        <span class="text-xs text-text-secondary">{{ t("alerts.composite.newMemberHint") }}</span>
      </div>
      <div class="p-3 pt-0">
        <QueryConfig
          :tab="term.draft.query_condition.type || 'custom'"
          :multiTimeRange="term.draft.query_condition.multi_time_range || []"
          :columns="columns"
          :streamFieldsMap="streamFieldsMap"
          :generatedSqlQuery="''"
          :inputData="term.draft.query_condition"
          :streamType="term.draft.stream_type"
          :isRealTime="'false'"
          :sqlQuery="term.draft.query_condition.sql"
          :promqlQuery="term.draft.query_condition.promql"
          :vrlFunction="term.draft.query_condition.vrl_function || ''"
          :streamName="term.draft.stream_name"
          :isAggregationEnabled="isAggregationEnabled"
          :beingUpdated="locked"
          :promqlCondition="term.draft.query_condition.promql_condition"
          :triggerCondition="mergedTrigger"
          :hideSchedule="true"
          @update:tab="(val) => (term.draft.query_condition.type = val)"
          @input:update="() => {}"
          @update:sqlQuery="(val) => (term.draft.query_condition.sql = val)"
          @update:promqlQuery="(val) => (term.draft.query_condition.promql = val)"
          @update:vrlFunction="(val) => (term.draft.query_condition.vrl_function = val)"
          @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
          @update:aggregation="(val) => (term.draft.query_condition.aggregation = val)"
          @update:promqlCondition="(val) => (term.draft.query_condition.promql_condition = val)"
          @update:triggerCondition="onTriggerConditionUpdate"
        />
      </div>
    </template>
    </div><!-- /v-show collapse body -->
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import useStreams from "@/composables/useStreams";
import QueryConfig from "@/components/alerts/steps/QueryConfig.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

/** Slugifies an alert name into a valid alias, e.g. "Checkout Errors" -> "checkout_errors". */
export const slugifyAlias = (name: string): string =>
  (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "term";

export default defineComponent({
  name: "CompositeTermCard",
  components: { QueryConfig, OSelect, OInput, OButton, OIcon, OToggleGroup, OToggleGroupItem },
  props: {
    /** The term object (mutated in place; the parent owns the reactive array). */
    term: {
      type: Object as any,
      required: true,
    },
    /** Available member alerts in the composite's folder. */
    memberOptions: {
      type: Array as () => Array<{
        label: string;
        value: string;
        queryType?: string;
        operator?: string;
        threshold?: any;
      }>,
      default: () => [],
    },
    loadingMembers: {
      type: Boolean,
      default: false,
    },
    canRemove: {
      type: Boolean,
      default: true,
    },
    beingUpdated: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["remove", "open-member"],
  setup(props) {
    const { t } = useI18n();
    const { getStreams, getStream } = useStreams();

    // The member-alert option matching the currently referenced alert_id, if
    // it has resolved in the parent's option list.
    const selectedMember = computed(() =>
      props.term.mode === "existing" && props.term.alert_id
        ? props.memberOptions.find((o) => o.value === props.term.alert_id)
        : undefined,
    );

    // A term is locked (mode/stream/query frozen) only when editing an existing
    // composite AND the term was already saved. Terms added this session
    // (_isNew) stay fully editable so authors can add members on update.
    const locked = computed(() => props.beingUpdated && !props.term._isNew);

    // Readable comparison glyph for the referenced alert's threshold.
    const operatorText = computed(() => {
      const map: Record<string, string> = {
        ">=": "≥",
        "<=": "≤",
        "!=": "≠",
        ">": ">",
        "<": "<",
        "=": "=",
      };
      return map[selectedMember.value?.operator || ""] || selectedMember.value?.operator || "≥";
    });

    const collapsed = ref(false);
    const collapsedSummary = computed(() => {
      if (props.term.mode === "existing") {
        return props.term.member_name || t("alerts.composite.selectMember");
      }
      const d = props.term.draft || {};
      return d.stream_name
        ? `${d.stream_type} / ${d.stream_name}`
        : t("alerts.composite.newMemberShort");
    });

    const streamTypes = ["logs", "metrics", "traces"];
    const streamNameOptions = ref<string[]>([]);
    const columns = ref<any[]>([]);
    const isFetchingStreams = ref(false);
    const isAggregationEnabled = ref(
      !!props.term.draft?.query_condition?.aggregation?.group_by?.length,
    );

    const streamFieldsMap = computed(() => {
      const map: any = {};
      columns.value.forEach((f: any) => {
        map[f.value] = f;
      });
      return map;
    });

    // Threshold (operator + count) is per-term; the schedule is inherited from
    // the composite, so only operator/threshold are exposed to QueryConfig.
    const mergedTrigger = computed(() => ({
      operator: props.term.draft.operator,
      threshold: props.term.draft.threshold,
      period: 10,
      frequency: 10,
      frequency_type: "minutes",
      silence: 10,
    }));

    const onTriggerConditionUpdate = (val: any) => {
      props.term.draft.operator = val.operator;
      props.term.draft.threshold = val.threshold;
    };

    // Only [A-Za-z0-9_] in the alias (it's the expression identifier).
    const onAliasInput = (val: string) => {
      props.term.name = (val || "").replace(/[^A-Za-z0-9_]/g, "");
    };

    const onModeChange = (mode: string) => {
      props.term.mode = mode;
      // Switching modes clears the previous reference/draft binding.
      if (mode === "new") {
        props.term.alert_id = "";
        props.term.member_name = "";
      }
    };

    const onMemberSelect = (val: string) => {
      props.term.alert_id = val;
      const opt = props.memberOptions.find((o) => o.value === val);
      props.term.member_name = opt?.label || "";
      if (!props.term.name || /^[A-Za-z]$/.test(props.term.name)) {
        props.term.name = slugifyAlias(opt?.label || props.term.name);
      }
    };

    const loadStreamNames = async (streamType: string) => {
      if (!streamType) {
        streamNameOptions.value = [];
        return;
      }
      isFetchingStreams.value = true;
      try {
        const res: any = await getStreams(streamType, false);
        streamNameOptions.value = (res?.list || []).map((s: any) => s.name);
      } catch {
        streamNameOptions.value = [];
      } finally {
        isFetchingStreams.value = false;
      }
    };

    const loadStreamFields = async (streamName: string) => {
      if (!streamName || !props.term.draft.stream_type) {
        columns.value = [];
        return;
      }
      try {
        const data: any = await getStream(streamName, props.term.draft.stream_type, true);
        columns.value = Array.isArray(data?.schema)
          ? data.schema.map((c: any) => ({ label: c.name, value: c.name, type: c.type }))
          : [];
      } catch {
        columns.value = [];
      }
    };

    const onStreamTypeChange = (val: string) => {
      props.term.draft.stream_type = val;
      props.term.draft.stream_name = "";
      columns.value = [];
      loadStreamNames(val);
    };

    const onStreamNameChange = (val: string) => {
      props.term.draft.stream_name = val;
      loadStreamFields(val);
    };

    onMounted(() => {
      if (props.term.mode === "new" && props.term.draft.stream_type) {
        loadStreamNames(props.term.draft.stream_type);
        if (props.term.draft.stream_name) loadStreamFields(props.term.draft.stream_name);
      }
    });

    watch(
      () => props.term.mode,
      (mode) => {
        if (mode === "new" && props.term.draft.stream_type && !streamNameOptions.value.length) {
          loadStreamNames(props.term.draft.stream_type);
        }
      },
    );

    return {
      t,
      locked,
      selectedMember,
      operatorText,
      collapsed,
      collapsedSummary,
      streamTypes,
      streamNameOptions,
      columns,
      streamFieldsMap,
      isFetchingStreams,
      isAggregationEnabled,
      mergedTrigger,
      onTriggerConditionUpdate,
      onAliasInput,
      onModeChange,
      onMemberSelect,
      onStreamTypeChange,
      onStreamNameChange,
    };
  },
});
</script>
