<template>
  <div
    data-test="add-stream-routing-section"
    class="full-width full-height bg-white"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md">Add Stream Routing</div>
    <q-separator />

    <div class="stream-routing-container q-px-md q-pt-md q-pr-xl">
      <div
        data-test="stream-routing-name-input"
        class="o2-input"
        style="padding-top: 12px"
      >
        <q-input
          v-model="streamRoute.destinationStreamName"
          :label="t('alerts.name') + ' *'"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          v-bind:readonly="isUpdating"
          v-bind:disable="isUpdating"
          :rules="[(val: any) => !!val.trim() || 'Field is required!']"
          tabindex="0"
          style="width: 480px"
        />
      </div>

      <real-time-alert
        :columns="filteredColumns"
        :conditions="streamRoute.conditions"
        @field:add="addField"
        @field:remove="removeField"
      />

      <div
        class="flex justify-start q-mt-lg q-py-sm full-width"
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
      >
        <q-btn
          data-test="add-report-cancel-btn"
          class="text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
          @click="openCancelDialog"
        />
        <q-btn
          data-test="add-report-save-btn"
          :label="t('alerts.save')"
          class="text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          no-caps
          @click="saveRouting"
        />
      </div>
    </div>
  </div>
  <ConfirmDialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>
<script lang="ts" setup>
import { onMounted, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import RealTimeAlert from "../alerts/RealTimeAlert.vue";
import { getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import NodeLinks from "./NodeLinks.vue";
import useStreams from "@/composables/useStreams";

interface RouteCondition {
  column: string;
  operator: string;
  value: any;
  id: string;
}

interface StreamRoute {
  sourceStreamName: string;
  destinationStreamName: string;
  sourceStreamType: string;
  destinationStreamType: string;
  conditions: RouteCondition[];
}

const props = defineProps({
  nodeLinks: {
    type: Array,
    required: true,
  },
  sourceStreamName: {
    type: String,
    required: true,
  },
});

const { t } = useI18n();

const router = useRouter();

const store = useStore();

const { getStream, getStreams } = useStreams();

const emit = defineEmits(["update:node", "cancel:hideform"]);

const isUpdating = ref(false);

const filteredColumns: any = ref([]);

const isFetchingStreams = ref(false);

const filteredStreams: Ref<any[]> = ref([]);

const streams: any = ref({});

const indexOptions = ref([]);

const originalStreamFields: Ref<any[]> = ref([]);

const nodeLink = ref({
  from: "",
  to: "",
});

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const getDefaultStreamRoute = () => {
  return {
    sourceStreamName: "",
    destinationStreamName: "",
    sourceStreamType: "",
    destinationStreamType: "",
    conditions: [{ column: "", operator: "", value: "", id: getUUID() }],
  };
};

onMounted(() => {
  streamRoute.value.sourceStreamName = props.sourceStreamName;
  streamRoute.value.sourceStreamType = "logs";
  updateStreamFields();
});

const streamTypes = ["logs", "metrics", "traces"];

const streamRoute: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const originalStreamRouting: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const filterColumns = (options: any[], val: String, update: Function) => {
  let filteredOptions: any[] = [];
  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
    return filteredOptions;
  }
  update(() => {
    const value = val.toLowerCase();
    filteredOptions = options.filter(
      (column: any) => column.toLowerCase().indexOf(value) > -1
    );
  });
  return filteredOptions;
};

const filterStreams = (val: string, update: any) => {
  filteredStreams.value = filterColumns(indexOptions.value, val, update);
};

const updateStreamFields = async () => {
  let streamCols: any = [];
  const streams: any = await getStream(
    streamRoute.value.sourceStreamName,
    streamRoute.value.sourceStreamType,
    true
  );

  if (streams && Array.isArray(streams.schema)) {
    streamCols = streams.schema.map((column: any) => ({
      label: column.name,
      value: column.name,
      type: column.type,
    }));
  }
  originalStreamFields.value = [...streamCols];
  filteredColumns.value = [...streamCols];
};

const addField = () => {
  streamRoute.value.conditions.push({
    column: "",
    operator: "=",
    value: "",
    id: getUUID(),
  });
};

const removeField = (field: any) => {
  streamRoute.value.conditions = streamRoute.value.conditions.filter(
    (_field: any) => _field.id !== field.id
  );
};

const goToRoutings = () => {
  router.replace({
    name: "reports",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const openCancelDialog = () => {
  if (
    JSON.stringify(originalStreamRouting.value) ===
    JSON.stringify(streamRoute.value)
  ) {
    goToRoutings();
    return;
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel routing changes?";
  dialog.value.okCallback = goToRoutings;
};

const saveRouting = () => {
  // Save routing
  emit("update:node", { data: streamRoute.value, link: nodeLink.value });
};

const saveUpdatedLink = (link: { from: string; to: string }) => {
  nodeLink.value = link;
};
</script>

<style scoped>
.stream-routing-title {
  font-size: 20px;
  padding-top: 16px;
}
.stream-routing-container {
  width: fit-content;
  border-radius: 8px;
  /* box-shadow: 0px 0px 10px 0px #d2d1d1; */
}
</style>
