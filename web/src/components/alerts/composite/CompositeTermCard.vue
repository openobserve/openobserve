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

<!--
  CompositeTermCard — the editor for ONE term of a composite alert, shown one at
  a time inside the Terms tab strip (mirrors the dashboard panel query tabs). A
  term is either a query defined here (like a normal alert) or a reference to an
  existing alert. The query builder gets the full panel — never crammed into a row.
-->
<template>
  <div
    class="composite-term-editor flex flex-col gap-3"
    :data-test="`composite-term-editor-${term.name}`"
  >
    <!-- Top row: the term's source on the left, reuse toggle + remove on the
         right. Define mode → stream type/name inline; reuse mode → alert
         selector. Keeping them on one row removes the empty gap under the tabs. -->
    <div class="flex items-center gap-4 flex-wrap">
      <template v-if="term.mode === 'existing'">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.memberAlert") }} <span class="text-text-body">*</span></span>
          <OSelect
            :model-value="term.alert_id"
            :options="memberOptions"
            :loading="loadingMembers"
            searchable
            :placeholder="t('alerts.composite.selectMember')"
            class="w-80! h-7! min-h-7!"
            :data-test="`composite-term-${term.name}-member`"
            @update:model-value="onMemberSelect"
          />
        </div>
      </template>
      <template v-else>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.streamType") }} <span class="text-text-body">*</span></span>
          <OSelect
            :model-value="term.draft.stream_type"
            :options="streamTypes"
            :searchable="false"
            :disabled="locked"
            class="w-40! h-7! min-h-7!"
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
            class="w-52! h-7! min-h-7!"
            @update:model-value="onStreamNameChange"
          />
        </div>
      </template>

      <div class="flex-1" />

      <!-- Secondary opt-in (house pattern, cf. FunctionPicker/DestinationPicker):
           OFF (default) = define a query here, ON = reuse an existing alert.
           (Removing a term is the × on its tab, not a button here.) -->
      <OSwitch
        :model-value="term.mode === 'existing'"
        :label="t('alerts.composite.reuseExisting')"
        :disabled="locked"
        :data-test="`composite-term-${term.name}-reuse-toggle`"
        @update:model-value="(v) => onModeChange(v ? 'existing' : 'new')"
      />
    </div>

    <!-- Reuse mode: the referenced alert's trigger summary + edit link -->
    <div
      v-if="term.mode === 'existing' && selectedMember"
      class="flex items-center gap-2 text-xs text-text-secondary"
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

    <!-- Define mode: the full query builder -->
    <QueryConfig
      v-if="term.mode === 'new'"
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

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import useStreams from "@/composables/useStreams";
import QueryConfig from "@/components/alerts/steps/QueryConfig.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

export default defineComponent({
  name: "CompositeTermCard",
  components: { QueryConfig, OSelect, OIcon, OSwitch },
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
    beingUpdated: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["open-member"],
  setup(props) {
    const { t } = useI18n();
    const { getStreams, getStream } = useStreams();

    // Alias the parent-owned `term` prop (the parent mutates the composite's
    // terms array it owns; the editor edits its slice in place). Writing through
    // this computed keeps the same reference, satisfying vue/no-mutating-props.
    const term = computed(() => props.term);

    // The member-alert option matching the currently referenced alert_id.
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

    const onModeChange = (mode: string) => {
      term.value.mode = mode;
      // Switching to "define a query" clears the previous reference binding.
      if (mode === "new") {
        term.value.alert_id = "";
        term.value.member_name = "";
        if (term.value.draft?.stream_type) loadStreamNames(term.value.draft.stream_type);
      }
    };

    const onMemberSelect = (val: SelectModelValue) => {
      const id = Array.isArray(val) ? "" : String(val ?? "");
      term.value.alert_id = id;
      const opt = props.memberOptions.find((o) => o.value === id);
      term.value.member_name = opt?.label || "";
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

    // Write a single query_condition field of the draft through the computed
    // alias, keeping the QueryConfig event bindings prop-mutation free.
    const setDraftQc = (key: string, val: any) => {
      term.value.draft.query_condition[key] = val;
    };

    onMounted(() => {
      if (term.value.mode === "new" && term.value.draft?.stream_type) {
        loadStreamNames(term.value.draft.stream_type);
        if (term.value.draft.stream_name) loadStreamFields(term.value.draft.stream_name);
      }
    });

    watch(
      () => term.value.mode,
      (mode) => {
        if (mode === "new" && term.value.draft?.stream_type && !streamNameOptions.value.length) {
          loadStreamNames(term.value.draft.stream_type);
        }
      },
    );

    return {
      t,
      locked,
      selectedMember,
      operatorText,
      streamTypes,
      streamNameOptions,
      columns,
      streamFieldsMap,
      isFetchingStreams,
      isAggregationEnabled,
      mergedTrigger,
      onTriggerConditionUpdate,
      onModeChange,
      onMemberSelect,
      onStreamTypeChange,
      onStreamNameChange,
      setDraftQc,
    };
  },
});
</script>
