<template>
  <div data-test="add-stream-routing-section" class="bg-white full-height">
    <div class="q-py-sm q-px-md flex justify-between items-center">
      <div class="stream-routing-title">Stream Routing</div>
      <q-icon
        data-test="stream-routing-close-dialog-btn"
        name="cancel"
        class="cursor-pointer"
        size="20px"
        @click="emits('cancel:hideform')"
      />
    </div>
    <q-separator />
    <div class="stream-routing-container q-px-md q-pt-md">
      <div
        data-test="stream-routing-name-input"
        class="o2-input"
        style="padding-top: 12px"
      >
        <OInput
          v-model="streamRoute.destinationStreamName"
          :label="t('alerts.name') + ' *'"
          data-test="stream-routing-destination-name-input"
          v-bind:readonly="isUpdating"
          v-bind:disabled="isUpdating"
          :error="!!nameError"
          :error-message="nameError"
          tabindex="0"
          style="width: 480px"
          @blur="nameError = !streamRoute.destinationStreamName.trim() ? 'Field is required!' : ''"
          @update:model-value="nameError = ''"
        />
      </div>
      <div class="flex justify-start items-center" style="padding-top: 0px">
        <div
          data-test="add-alert-stream-type-select"
          class="alert-stream-type o2-input q-mr-sm"
          style="padding-top: 0"
        >
          <OSelect
            v-model="streamRoute.sourceStreamType"
            :options="streamTypes"
            :label="t('alerts.streamType') + ' *'"
            v-bind:readonly="isUpdating"
            v-bind:disabled="isUpdating"
            :error="!!streamTypeError"
            :error-message="streamTypeError"
            style="min-width: 220px"
            @update:model-value="() => { streamTypeError = ''; updateStreams(); }"
            @blur="streamTypeError = !streamRoute.sourceStreamType ? 'Field is required!' : ''"
          />
        </div>
        <div
          data-test="add-alert-stream-select"
          class="o2-input"
          style="padding-top: 0"
        >
          <OSelect
            v-model="streamRoute.sourceStreamName"
            :options="filteredStreams"
            :label="t('alerts.stream_name') + ' *'"
            :loading="isFetchingStreams"
            searchable
            :searchDebounce="400"
            v-bind:readonly="isUpdating"
            v-bind:disabled="isUpdating"
            :error="!!streamNameError"
            :error-message="streamNameError"
            style="min-width: 250px !important; width: 250px !important"
            @search="filterStreams"
            @update:model-value="(val) => { streamNameError = ''; updateStreamFields(val) }"
            @blur="streamNameError = !streamRoute.sourceStreamName ? 'Field is required!' : ''"
          />
        </div>
      </div>

      <real-time-alert
        :columns="filteredColumns"
        :conditions="streamRoute.conditions"
        @field:add="addField"
        @field:remove="removeField"
      />

      <div
        class="flex justify-start q-mt-lg q-py-sm full-width tw:gap-2"
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
      >
        <OButton
          data-test="add-report-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="openCancelDialog"
        >
          {{ t('alerts.cancel') }}
        </OButton>
        <OButton
          data-test="add-report-save-btn"
          variant="primary"
          size="sm-action"
          @click="saveRouting"
        >
          {{ t('alerts.save') }}
        </OButton>
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
import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import RealTimeAlert from "../alerts/RealTimeAlert.vue";
import { getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

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

const { t } = useI18n();

const emits = defineEmits(["cancel:hideform"]);

const isUpdating = ref(false);

const filteredColumns: any = ref([]);

const isFetchingStreams = ref(false);

const filteredStreams = ref([]);

const nameError = ref('');
const streamTypeError = ref('');
const streamNameError = ref('');

const router = useRouter();

const store = useStore();

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

const streamTypes = ["logs", "metrics", "traces"];

const streamRoute: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const originalStreamRouting: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const updateStreams = (resetStream = true) => {
  // if (resetStream) formData.value.stream_name = "";
  // if (streams.value[formData.value.stream_type]) {
  //   schemaList.value = streams.value[formData.value.stream_type];
  //   indexOptions.value = streams.value[formData.value.stream_type].map(
  //     (data: any) => {
  //       return data.name;
  //     }
  //   );
  //   return;
  // }
  // if (!formData.value.stream_type) return Promise.resolve();
  // isFetchingStreams.value = true;
  // return getStreams(formData.value.stream_type, false)
  //   .then((res: any) => {
  //     streams.value[formData.value.stream_type] = res.list;
  //     schemaList.value = res.list;
  //     indexOptions.value = res.list.map((data: any) => {
  //       return data.name;
  //     });
  //     if (formData.value.stream_name)
  //       updateStreamFields(formData.value.stream_name);
  //     return Promise.resolve();
  //   })
  //   .catch(() => Promise.reject())
  //   .finally(() => (isFetchingStreams.value = false));
};

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

const filterStreams = (val: string) => {
  // filteredStreams.value = filterColumns(indexOptions.value, val, update);
};

const updateStreamFields = async (stream_name: any) => {
  // let streamCols: any = [];
  // const streams: any = await getStream(
  //   stream_name,
  //   formData.value.stream_type,
  //   true
  // );
  // if (streams && Array.isArray(streams.schema)) {
  //   streamCols = streams.schema.map((column: any) => ({
  //     label: column.name,
  //     value: column.name,
  //     type: column.type,
  //   }));
  // }
  // originalStreamFields.value = [...streamCols];
  // filteredColumns.value = [...streamCols];
  // onInputUpdate("stream_name", stream_name);
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

const saveRouting = () => {};
</script>

<style scoped>
.stream-routing-title {
  font-size: 18px;
}
.stream-routing-container {
  width: fit-content;
  border-radius: 8px;
  /* box-shadow: 0px 0px 10px 0px #d2d1d1; */
}
</style>
