<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div class="min-w-0">
    <OSelect
      :model-value="selectValue"
      :options="flatOptions"
      :label="t('dashboard.streamFieldSelect.selectField')"
      label-position="inside"
      searchable
      data-test="stream-field-select"
      class="o2-custom-select-dashboard"
      @update:model-value="onSelect"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import useStreams from "@/composables/useStreams";
import OSelect from "@/lib/forms/Select/OSelect.vue";

// Composite key separator — unlikely to appear in stream/field names
const SEP = "\x00";

export default defineComponent({
  name: "StreamFieldSelect",

  props: {
    streams: {
      type: Array,
      required: true,
    },
    modelValue: {
      type: Object,
      default: () => ({}),
    },
  },

  emits: ["update:modelValue"],

  components: { OSelect },

  setup(props, { emit }) {
    const { t } = useI18n();

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const { getStream } = useStreams();
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    // Raw loaded groups: { label, streamRef, children: [{name, ...}] }
    const groups = ref<{ label: string; streamRef: any; children: any[] }[]>(
      [],
    );

    // valueMap: composite key -> { field, streamAlias }
    const valueMap = new Map<string, { field: string; streamAlias?: string }>();

    // Flat OSelect-compatible options: headers + { label, value } items
    const flatOptions = computed(() => {
      const result: any[] = [];
      const showHeaders = groups.value.length > 1;
      for (const group of groups.value) {
        if (showHeaders) {
          result.push({ header: true, label: group.label });
        }
        for (const field of group.children ?? []) {
          result.push({
            label: field.name,
            value: `${group.label}${SEP}${field.name}`,
          });
        }
      }
      return result;
    });

    // Derive the currently selected string key from the modelValue object.
    // Computed from `groups` (reactive ref) so it re-runs after fields load.
    const selectValue = computed<string | null>(() => {
      const mv = props.modelValue;

      if (!mv?.field) return undefined;

      // Exact match: field + streamAlias
      for (const group of groups.value) {
        const fieldStreamAlias = group.streamRef?.streamAlias ?? null;
        if ((mv.streamAlias ?? null) === fieldStreamAlias) {
          const match = group.children?.find((f: any) => f.name === mv.field);
          if (match) return `${group.label}${SEP}${match.name}`;
        }
      }

      // Fallback: match by field name only
      for (const group of groups.value) {
        const match = group.children?.find((f: any) => f.name === mv.field);
        if (match) return `${group.label}${SEP}${match.name}`;
      }

      return null;
    });

    async function loadStreamFields(streamName: string) {
      if (!streamName) return null;
      try {
        return await getStream(
          streamName,
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type ?? "logs",
          true,
        );
      } catch {
        return null;
      }
    }

    async function fetchFieldsForStreams() {
      if (!props.streams || props.streams.length === 0) {
        groups.value = [];
        valueMap.clear();
        return;
      }

      valueMap.clear();

      groups.value = await Promise.all(
        props.streams.map(async (stream: any) => {
          const schema = await loadStreamFields(stream.stream);
          const label = stream.streamAlias
            ? `${stream.stream}(${stream.streamAlias})`
            : `${stream.stream}`;
          const children = (schema?.schema ?? []).map((field: any) => ({
            ...field,
            stream,
          }));

          for (const field of children) {
            const key = `${label}${SEP}${field.name}`;
            valueMap.set(key, {
              field: field.name,
              streamAlias: stream.streamAlias,
            });
          }

          return { label, streamRef: stream, children };
        }),
      );
    }

    function onSelect(key: string | null) {
      if (!key) return;
      const mapped = valueMap.get(key);
      if (mapped) {
        emit("update:modelValue", { ...mapped });
      } else {
        // Fallback: treat raw value as plain field name
        emit("update:modelValue", { field: key, streamAlias: undefined });
      }
    }

    // Re-fetch when streams list changes
    watch(() => props.streams, fetchFieldsForStreams, {
      immediate: true,
      deep: true,
    });

    return {
      t,
      flatOptions,
      selectValue,
      onSelect,
    };
  },
});
</script>
