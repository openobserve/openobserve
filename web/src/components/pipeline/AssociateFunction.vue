<template>
  <div
    data-test="add-stream-routing-section"
    class="full-width bg-white full-height"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md">Associate Function</div>
    <q-separator />
    <div class="stream-routing-container full-width q-px-md q-pt-md">
      <q-toggle
        class="q-mb-sm"
        label="Create new function"
        v-model="createNewFunction"
      />
      <div
        v-if="!createNewFunction"
        class="flex justify-start items-center full-width"
        style="padding-top: 0px"
      >
        <div
          data-test="add-alert-stream-type-select"
          class="alert-stream-type o2-input q-mr-sm full-width"
          style="padding-top: 0"
        >
          <q-select
            v-model="selectedFunction"
            :options="filteredFunctions"
            :label="t('function.selectFunction') + ' *'"
            :popup-content-style="{ textTransform: 'lowercase' }"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop no-case"
            stack-label
            outlined
            filled
            dense
            v-bind:readonly="isUpdating"
            v-bind:disable="isUpdating"
            @update:model-value="updateStreams()"
            :rules="[(val: any) => !!val || 'Field is required!']"
            style="min-width: 220px"
          />
        </div>
      </div>

      <div v-if="createNewFunction" class="pipeline-add-function">
        <AddFunction
          ref="addFunctionRef"
          @update:list="onFunctionCreation"
          @cancel:hideform="cancelFunctionCreation"
        />
      </div>

      <NodeLinks :tree="[]" />

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
          @click="saveFunction"
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
import { ref, type Ref, defineEmits, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import RealTimeAlert from "../alerts/RealTimeAlert.vue";
import { getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import AddFunction from "../functions/AddFunction.vue";
import NodeLinks from "./NodeLinks.vue";
import functionsService from "@/services/jstransform";

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

const emit = defineEmits(["update:node", "cancel:hideform"]);

const { t } = useI18n();

const addFunctionRef: any = ref(null);

const isUpdating = ref(false);

const selectedFunction = ref("");

const filteredFunctions = ref([]);

const createNewFunction = ref(false);

const router = useRouter();

const store = useStore();

const nodes = {};

const links = {};

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

onBeforeMount(() => {
  getFunctions();
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

const filterStreams = (val: string, update: any) => {
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

const saveFunction = () => {
  if (createNewFunction.value) {
    addFunctionRef.value.onSubmit();
  } else {
    emit("update:node", { name: selectedFunction.value });
  }
};

const onFunctionCreation = (_function: any) => {
  // Assing newly created function to the block
  emit("update:node", _function);
};

const cancelFunctionCreation = () => {
  emit("cancel:hideform");
};

const getFunctions = () => {
  functionsService
    .list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier
    )
    .then((res) => {
      filteredFunctions.value = res.data.list.map((func: any) => func.name);
    });
};
</script>

<style scoped>
.stream-routing-title {
  font-size: 20px;
  padding-top: 16px;
}
.stream-routing-container {
  border-radius: 8px;
  /* box-shadow: 0px 0px 10px 0px #d2d1d1; */
}
</style>

<style lang="scss">
.pipeline-add-function {
  .add-function-header,
  .q-separator {
    display: none;
  }

  .add-function-actions {
    display: none;
  }

  .add-function-name-input {
    width: 100%;
    margin-left: 0px !important;

    label {
      width: 100%;
      padding-left: 0;
    }
  }
}
</style>
