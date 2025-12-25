<template>
  <div>
    <div>
      <q-select
        ref="streamFieldSelect"
        filled
        v-model="displayValue"
        :options="filteredOptions"
        dense
        label="Select Field"
        use-input
        input-debounce="0"
        behavior="menu"
        hide-selected
        fill-input
        borderless
        @filter="filterFields"
        data-test="stream-field-select"
        class="o2-custom-select-dashboard"
      >
        <template v-slot:option="scope">
          <q-expansion-item
            expand-separator
            group="streamGroup"
            :default-opened="scope.index === 0 ? true : false"
            header-class="text-weight-bold"
            :label="scope.opt.label"
            :data-test="`stream-field-select-group-${scope.index}`"
          >
            <template v-for="child in scope.opt.children" :key="child.name">
              <q-item
                clickable
                v-ripple
                v-close-popup
                @click="selectField(child)"
                :data-test="`stream-field-select-option-${child.name}`"
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

export interface OptionChild {
  label: string;
  value: string;
}

export interface Option {
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
    const displayValue = ref(props.modelValue?.field || "");
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

    function updateInputValue(val: string) {
      if (val !== undefined && val !== null) {
        displayValue.value = val;
        streamFieldSelect?.value?.updateInputValue?.(val);
      }
    }

    async function fetchFieldsForStreams() {
      if (!props.streams || props.streams.length === 0) {
        options.value = [];
        filteredOptions.value = [];
        displayValue.value = internalModel.value?.field || "";
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

      displayValue.value = internalModel.value?.field || "";
    }

    function filterFields(val: string, update: any) {
      // val is now always a string since we're using displayValue
      let searchText = "";

      if (val === "" || val === displayValue.value) {
        update(() => {
          filteredOptions.value = [...options?.value];
        });
        return;
      }

      // val is always string now
      if (val !== "") {
        searchText = val.toLowerCase();
      } else {
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
      displayValue.value = field.name;
      updateInputValue(field.name);
    }

    // Watch for v-model changes
    watch(internalModel, (newValue) => {
      emit("update:modelValue", newValue);
      displayValue.value = newValue?.field || "";
    });

    // Watch for external modelValue changes
    watch(() => props.modelValue, (newValue) => {
      internalModel.value = newValue;
      displayValue.value = newValue?.field || "";
    });

    // Watch for streams changes
    watch(() => props.streams, fetchFieldsForStreams, { immediate: true });

    return {
      internalModel,
      displayValue,
      options,
      filteredOptions,
      selectField,
      filterFields,
      streamFieldSelect,
      updateInputValue,
    };
  },
});
</script>