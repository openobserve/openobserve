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
    <!-- Term header: label chip + streams + remove -->
    <div
      class="flex items-center gap-3 px-3 py-2 border-b border-border-default flex-wrap"
    >
      <OTag type="default" :value="term.name" class="uppercase font-semibold" />

      <!-- Stream Type -->
      <div class="flex items-center gap-1.5">
        <div
          class="text-xs font-semibold whitespace-nowrap"
          :class="store.state.theme === 'dark' ? 'text-[rgba(255,255,255,0.7)]' : 'text-[rgba(0,0,0,0.72)]'"
        >
          {{ t("alerts.streamType") }} <span class="text-text-primary">*</span>
        </div>
        <OSelect
          :model-value="term.stream_type"
          :options="streamTypes"
          :searchable="false"
          :disabled="beingUpdated"
          class="h-[28px]! min-h-[28px]!"
          :data-test="`composite-term-${term.name}-stream-type`"
          @update:model-value="onStreamTypeChange"
        />
      </div>

      <!-- Stream Name (required for Custom terms) -->
      <div class="flex items-center gap-1.5">
        <div
          class="text-xs font-semibold whitespace-nowrap"
          :class="store.state.theme === 'dark' ? 'text-[rgba(255,255,255,0.7)]' : 'text-[rgba(0,0,0,0.72)]'"
        >
          {{ t("alerts.stream_name") }}
          <span v-if="isCustom" class="text-text-primary">*</span>
        </div>
        <OSelect
          :model-value="term.stream_name"
          :options="streamNameOptions"
          :loading="isFetchingStreams"
          :disabled="beingUpdated || !term.stream_type"
          class="h-[28px]! min-h-[28px]! min-w-[160px]"
          :data-test="`composite-term-${term.name}-stream-name`"
          @update:model-value="onStreamNameChange"
        />
      </div>

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

    <!-- Query builder + threshold (reused from the single-alert flow) -->
    <div class="p-3">
      <QueryConfig
        :tab="term.query_condition.type || 'custom'"
        :multiTimeRange="term.query_condition.multi_time_range || []"
        :columns="columns"
        :streamFieldsMap="streamFieldsMap"
        :generatedSqlQuery="''"
        :inputData="term.query_condition"
        :streamType="term.stream_type"
        :isRealTime="'false'"
        :sqlQuery="term.query_condition.sql"
        :promqlQuery="term.query_condition.promql"
        :vrlFunction="term.query_condition.vrl_function || ''"
        :streamName="term.stream_name"
        :isAggregationEnabled="isAggregationEnabled"
        :beingUpdated="beingUpdated"
        :promqlCondition="term.query_condition.promql_condition"
        :triggerCondition="mergedTrigger"
        :hideSchedule="true"
        @update:tab="(val) => (term.query_condition.type = val)"
        @input:update="() => {}"
        @update:sqlQuery="(val) => (term.query_condition.sql = val)"
        @update:promqlQuery="(val) => (term.query_condition.promql = val)"
        @update:vrlFunction="(val) => (term.query_condition.vrl_function = val)"
        @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
        @update:aggregation="(val) => (term.query_condition.aggregation = val)"
        @update:promqlCondition="(val) => (term.query_condition.promql_condition = val)"
        @update:triggerCondition="onTriggerConditionUpdate"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useStreams from "@/composables/useStreams";
import QueryConfig from "@/components/alerts/steps/QueryConfig.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

export default defineComponent({
  name: "CompositeTermCard",
  components: { QueryConfig, OSelect, OButton, OTag },
  props: {
    /** The term object (mutated in place; the parent owns the reactive array). */
    term: {
      type: Object as any,
      required: true,
    },
    /** Available stream types (logs | metrics | traces). */
    streamTypes: {
      type: Array as () => string[],
      default: () => ["logs", "metrics", "traces"],
    },
    /** The shared composite schedule (parent trigger_condition). */
    triggerCondition: {
      type: Object as any,
      required: true,
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
  emits: ["remove"],
  setup(props) {
    const { t } = useI18n();
    const store = useStore();
    const { getStreams, getStream } = useStreams();

    const streamNameOptions = ref<string[]>([]);
    const columns = ref<any[]>([]);
    const isFetchingStreams = ref(false);
    const isAggregationEnabled = ref(
      !!props.term.query_condition?.aggregation?.group_by?.length,
    );

    const isCustom = computed(
      () => (props.term.query_condition?.type || "custom") === "custom",
    );

    const streamFieldsMap = computed(() => {
      const map: any = {};
      columns.value.forEach((f: any) => {
        map[f.value] = f;
      });
      return map;
    });

    // The threshold (operator + count) is per-term, while the schedule
    // (period / frequency / silence) is shared across the composite. Present a
    // merged object to QueryConfig and split writes back on update.
    const mergedTrigger = computed(() => ({
      ...props.triggerCondition,
      operator: props.term.operator,
      threshold: props.term.threshold,
    }));

    const onTriggerConditionUpdate = (val: any) => {
      // Only the threshold (operator + count) is per-term. The schedule
      // (period / frequency / silence) is shared and edited in the composite's
      // "Evaluation schedule" section, so it is intentionally NOT written here.
      props.term.operator = val.operator;
      props.term.threshold = val.threshold;
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
      if (!streamName || !props.term.stream_type) {
        columns.value = [];
        return;
      }
      try {
        const data: any = await getStream(streamName, props.term.stream_type, true);
        if (data && Array.isArray(data.schema)) {
          columns.value = data.schema.map((c: any) => ({
            label: c.name,
            value: c.name,
            type: c.type,
          }));
        } else {
          columns.value = [];
        }
      } catch {
        // A missing/unauthorized stream must not blank the term card.
        columns.value = [];
      }
    };

    const onStreamTypeChange = (val: string) => {
      props.term.stream_type = val;
      props.term.stream_name = "";
      columns.value = [];
      loadStreamNames(val);
    };

    const onStreamNameChange = (val: string) => {
      props.term.stream_name = val;
      loadStreamFields(val);
    };

    onMounted(() => {
      if (props.term.stream_type) loadStreamNames(props.term.stream_type);
      if (props.term.stream_name) loadStreamFields(props.term.stream_name);
    });

    watch(
      () => props.term.stream_type,
      (val, old) => {
        if (val && val !== old) loadStreamNames(val);
      },
    );

    return {
      t,
      store,
      streamNameOptions,
      columns,
      streamFieldsMap,
      isFetchingStreams,
      isAggregationEnabled,
      isCustom,
      mergedTrigger,
      onTriggerConditionUpdate,
      onStreamTypeChange,
      onStreamNameChange,
    };
  },
});
</script>
