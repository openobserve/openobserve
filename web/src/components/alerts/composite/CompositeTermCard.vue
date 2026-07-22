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
    class="composite-term-card card-container border border-border-default rounded-surface"
    :data-test="`composite-term-card-${term.name}`"
  >
    <!-- Header: collapse + alias + mode toggle + remove -->
    <div
      class="flex items-center gap-3 px-3 py-2 flex-wrap"
      :class="collapsed ? '' : 'border-b border-border-default'"
    >
      <button
        type="button"
        class="shrink-0 cursor-pointer text-text-secondary hover:text-text-body flex items-center"
        :data-test="`composite-term-${term.name}-collapse`"
        @click="collapsed = !collapsed"
      >
        <OIcon :name="collapsed ? 'chevron-right' : 'expand-more'" size="sm" />
      </button>

      <div class="flex items-center gap-1.5">
        <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.alias") }} <span class="text-text-body">*</span></span>
        <OInput
          :model-value="term.name"
          placeholder="A"
          class="w-22.5 h-7! min-h-7!"
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
        class="text-xs text-text-secondary truncate max-w-70"
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
        <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.memberAlert") }} <span class="text-text-body">*</span></span>
        <OSelect
          :model-value="term.alert_id"
          :options="memberOptions"
          :loading="loadingMembers"
          searchable
          :placeholder="t('alerts.composite.selectMember')"
          class="flex-1 min-w-55 h-7! min-h-7!"
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
          <span class="text-text-body font-medium">{{ operatorText }} {{ selectedMember.threshold }}</span>
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="flex items-center gap-1 text-accent hover:underline cursor-pointer shrink-0"
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
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.streamType") }} <span class="text-text-body">*</span></span>
          <OSelect
            :model-value="term.draft.stream_type"
            :options="streamTypes"
            :searchable="false"
            :disabled="locked"
            class="h-7! min-h-7!"
            @update:model-value="onStreamTypeChange"
          />
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.stream_name") }} <span class="text-text-body">*</span></span>
          <OSelect
            :model-value="term.draft.stream_name"
            :options="streamNameOptions"
            :loading="isFetchingStreams"
            :disabled="locked || !term.draft.stream_type"
            class="h-7! min-h-7! min-w-40"
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
          @update:tab="(val) => setDraftQc('type', val)"
          @input:update="() => {}"
          @update:sqlQuery="(val) => setDraftQc('sql', val)"
          @update:promqlQuery="(val) => setDraftQc('promql', val)"
          @update:vrlFunction="(val) => setDraftQc('vrl_function', val)"
          @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
          @update:aggregation="(val) => setDraftQc('aggregation', val)"
          @update:promqlCondition="(val) => setDraftQc('promql_condition', val)"
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
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
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

    // Alias the parent-owned `term` prop (the parent mutates the composite's
    // terms array it owns; the card edits its slice in place). Writing through
    // this computed keeps the same reference, so edits propagate as before while
    // satisfying vue/no-mutating-props.
    const term = computed(() => props.term);

    // The member-alert option matching the currently referenced alert_id, if
    // it has resolved in the parent's option list.
    const selectedMember = computed(() =>
      term.value.mode === "existing" && term.value.alert_id
        ? props.memberOptions.find((o) => o.value === term.value.alert_id)
        : undefined,
    );

    // A term is locked (mode/stream/query frozen) only when editing an existing
    // composite AND the term was already saved. Terms added this session
    // (_isNew) stay fully editable so authors can add members on update.
    const locked = computed(() => props.beingUpdated && !term.value._isNew);

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
      if (term.value.mode === "existing") {
        return term.value.member_name || t("alerts.composite.selectMember");
      }
      const d = term.value.draft || {};
      return d.stream_name
        ? `${d.stream_type} / ${d.stream_name}`
        : t("alerts.composite.newMemberShort");
    });

    const streamTypes = ["logs", "metrics", "traces"];
    const streamNameOptions = ref<string[]>([]);
    const columns = ref<any[]>([]);
    const isFetchingStreams = ref(false);
    const isAggregationEnabled = ref(
      !!term.value.draft?.query_condition?.aggregation?.group_by?.length,
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
      operator: term.value.draft.operator,
      threshold: term.value.draft.threshold,
      period: 10,
      frequency: 10,
      frequency_type: "minutes",
      silence: 10,
    }));

    const onTriggerConditionUpdate = (val: any) => {
      term.value.draft.operator = val.operator;
      term.value.draft.threshold = val.threshold;
    };

    // Only [A-Za-z0-9_] in the alias (it's the expression identifier).
    const onAliasInput = (val: string | number) => {
      term.value.name = String(val ?? "").replace(/[^A-Za-z0-9_]/g, "");
    };

    const onModeChange = (mode: string) => {
      term.value.mode = mode;
      // Switching modes clears the previous reference/draft binding.
      if (mode === "new") {
        term.value.alert_id = "";
        term.value.member_name = "";
      }
    };

    const onMemberSelect = (val: SelectModelValue) => {
      const id = Array.isArray(val) ? "" : String(val ?? "");
      term.value.alert_id = id;
      const opt = props.memberOptions.find((o) => o.value === id);
      term.value.member_name = opt?.label || "";
      if (!term.value.name || /^[A-Za-z]$/.test(term.value.name)) {
        term.value.name = slugifyAlias(opt?.label || term.value.name);
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
      if (!streamName || !term.value.draft.stream_type) {
        columns.value = [];
        return;
      }
      try {
        const data: any = await getStream(streamName, term.value.draft.stream_type, true);
        columns.value = Array.isArray(data?.schema)
          ? data.schema.map((c: any) => ({ label: c.name, value: c.name, type: c.type }))
          : [];
      } catch {
        columns.value = [];
      }
    };

    const onStreamTypeChange = (val: SelectModelValue) => {
      const st = Array.isArray(val) ? "" : String(val ?? "");
      term.value.draft.stream_type = st;
      term.value.draft.stream_name = "";
      columns.value = [];
      loadStreamNames(st);
    };

    const onStreamNameChange = (val: SelectModelValue) => {
      const sn = Array.isArray(val) ? "" : String(val ?? "");
      term.value.draft.stream_name = sn;
      loadStreamFields(sn);
    };

    // Write a single query_condition field of the draft (New-mode term) through
    // the computed alias, keeping the QueryConfig event bindings prop-mutation
    // free (vue/no-mutating-props).
    const setDraftQc = (key: string, val: any) => {
      term.value.draft.query_condition[key] = val;
    };

    onMounted(() => {
      if (term.value.mode === "new" && term.value.draft.stream_type) {
        loadStreamNames(term.value.draft.stream_type);
        if (term.value.draft.stream_name) loadStreamFields(term.value.draft.stream_name);
      }
    });

    watch(
      () => term.value.mode,
      (mode) => {
        if (mode === "new" && term.value.draft.stream_type && !streamNameOptions.value.length) {
          loadStreamNames(term.value.draft.stream_type);
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
      setDraftQc,
    };
  },
});
</script>
