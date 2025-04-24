<template>
  <div>
    <div>
      <q-select
        ref="streamFieldSelect"
        filled
        v-model="internalModel"
        :options="filteredOptions"
        dense
        use-input
        input-debounce="0"
        behavior="menu"
        hide-selected
        @filter="filterFields"
      >
        <template v-slot:option="scope">
          <q-expansion-item
            expand-separator
            group="streamGroup"
            :default-opened="scope.index === 0 ? true : false"
            header-class="text-weight-bold"
            :label="scope.opt.label"
          >
            <template v-for="child in scope.opt.children" :key="child.name">
              <q-item
                clickable
                v-ripple
                v-close-popup
                @click="selectField(child)"
              >
                <q-item-section>
                  <q-item-label v-html="child.name"></q-item-label>
                </q-item-section>
              </q-item>
            </template>
          </q-expansion-item>
        </template>
      </q-select>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, PropType, inject } from "vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import useStreams from "@/composables/useStreams";

interface OptionChild {
  label: string;
  value: string;
}

interface Option {
  label: string;
  children: OptionChild[];
}

export default defineComponent({
  name: "StreamFieldSelect",

  props: {
    streams: {
      type: Array,
      required: true,
    },
    modelValue: {
      type: Object,
      default: {},
    },
  },

  emits: ["update:modelValue"],

  setup(props, { emit }) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const internalModel = ref(props.modelValue);
    const options = ref<Option[]>([]);
    const filteredOptions = ref<Option[]>([]);

    const { getStream } = useStreams();
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const streamFieldSelect = ref<any>(null);

    async function loadStreamFields(streamName: string) {
      try {
        if (streamName != "") {
          return await getStream(
            streamName,
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type ?? "logs",
            true,
          ).then((res) => {
            return res;
          });
        } else {
        }
        return;
      } catch (e: any) {
        console.log("Error while loading stream fields");
      }
    }

    async function fetchFieldsForStreams() {
      if (!props.streams || props.streams.length === 0) {
        options.value = [];
        filteredOptions.value = [];
        streamFieldSelect?.value?.updateInputValue?.(
          internalModel.value?.field,
        );
        return;
      }

      // Fetch schema for each stream and build options
      options.value = await Promise.all(
        props.streams.map(async (stream: any) => {
          const streamSchemaObj = await loadStreamFields(stream.stream);

          return {
            label: stream.streamAlias
              ? `${stream.stream}(${stream.streamAlias})`
              : `${stream.stream}`,
            children: streamSchemaObj?.schema?.map((field: any) => ({
              ...field,
              stream: stream,
            })),
          };
        }),
      );

      // Initialize filtered options with all options
      filteredOptions.value = [...options?.value];

      streamFieldSelect?.value?.updateInputValue?.(internalModel.value?.field);
    }

    function filterFields(val: string | object, update: any) {
      // Handle both string and object values for val
      let searchText = "";

      if (val === "" || val === internalModel.value?.field) {
        update(() => {
          filteredOptions.value = [...options?.value];
        });
        return;
      }

      // Check if val is string or object
      if (typeof val === "string" && val !== "") {
        searchText = val.toLowerCase();
      } else {
        // If we can't determine the search text, just show all options
        update(() => {
          filteredOptions.value = [...options?.value];
        });
        return;
      }

      update(() => {
        const needle = searchText;
        // Filter options where either stream name (label) or field name contains the search term
        filteredOptions.value = options?.value
          ?.map((stream) => {
            // First check if stream name matches
            const streamMatches = stream?.label?.toLowerCase().includes(needle);

            // Then filter child fields that match
            const matchingFields = stream?.children?.filter((field: any) =>
              field?.name?.toLowerCase()?.includes(needle),
            );

            // If stream name matches or has matching fields, include in results
            if (streamMatches || matchingFields.length > 0) {
              return {
                ...stream,
                // If stream matches directly, include all fields
                // Otherwise only include matching fields
                children: streamMatches ? stream?.children : matchingFields,
              };
            }
            return null;
          })
          .filter(Boolean) as Option[];
      });
    }

    function selectField(field: any) {
      internalModel.value = {
        streamAlias: field?.stream?.streamAlias,
        field: field.name,
      };
      streamFieldSelect?.value?.updateInputValue?.(field.name);
    }

    // Watch for v-model changes
    watch(internalModel, (newValue) => {
      emit("update:modelValue", newValue);
    });

    // Watch for streams changes
    watch(() => props.streams, fetchFieldsForStreams, { immediate: true });

    return {
      internalModel,
      options,
      filteredOptions,
      selectField,
      filterFields,
      streamFieldSelect,
    };
  },
});
</script>
