<template>
  <div
    data-test="add-stream-routing-section"
    class="full-width bg-white full-height"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md">Associate Function</div>
    <q-separator />
    <div v-if="loading">
      <q-spinner
        v-if="loading"
        color="primary"
        size="40px"
        style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        "
      />
    </div>
    <div v-else class="stream-routing-container full-width q-px-md q-pt-md">
      <q-toggle
        class="q-mb-sm"
        :label="isUpdating ? 'Edit function' : 'Create new function'"
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
            @update:model-value="updateStreams()"
            :rules="[(val: any) => !!val || 'Field is required!']"
            style="min-width: 220px"
          />
        </div>
      </div>

      <div v-if="createNewFunction" class="pipeline-add-function">
        <AddFunction
          ref="addFunctionRef"
          :model-value="functionData"
          :is-updated="isUpdating"
          @update:list="onFunctionCreation"
          @cancel:hideform="cancelFunctionCreation"
        />
      </div>

      <div
        data-test="associate-function-order-input"
        class="o2-input"
        style="padding-top: 12px"
      >
        <q-input
          v-model="functionOrder"
          :label="t('function.order') + ' *'"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          type="number"
          :rules="[(val: any) => !!val.trim() || 'Field is required!']"
          tabindex="0"
          style="width: 480px"
        />
      </div>

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
        <q-btn
          v-if="isUpdating"
          data-test="associate-function-delete-btn"
          :label="t('pipeline.deleteNode')"
          class="text-bold no-border q-ml-md"
          color="negative"
          padding="sm xl"
          no-caps
          @click="openDeleteDialog"
        />
      </div>
    </div>
  </div>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>
<script lang="ts" setup>
import { ref, type Ref, defineEmits, onBeforeMount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import AddFunction from "../functions/AddFunction.vue";
import ConfirmDialog from "../ConfirmDialog.vue";

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
  defaultOrder: {
    type: Number,
    required: true,
    default: 1,
  },
  functionData: {
    type: Object,
    required: false,
    default: () => {
      return null;
    },
  },
  loading: {
    type: Boolean,
    required: false,
    default: false,
  },
  functions: {
    type: Array,
    required: true,
    default: () => {
      return [];
    },
  },
});

const emit = defineEmits(["update:node", "cancel:hideform", "delete:node"]);

const { t } = useI18n();

const addFunctionRef: any = ref(null);

const isUpdating = ref(false);

const selectedFunction = ref("");

const functionOrder = ref(props.defaultOrder);

const filteredFunctions: Ref<any[]> = ref([]);

const createNewFunction = ref(false);

const router = useRouter();

const store = useStore();

const nodes = {};

const links = {};

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

watch(
  () => props.functions,
  (newVal) => {
    filteredFunctions.value = [...newVal];
  },
  {
    deep: true,
  }
);

onBeforeMount(() => {
  filteredFunctions.value = [...props.functions];

  if (props.functionData) {
    isUpdating.value = true;
    selectedFunction.value = props.functionData.name;
    functionOrder.value = props.functionData.order;
  }
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

const openCancelDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.okCallback = () => emit("cancel:hideform");
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message =
    "Are you sure you want to delete function association?";
  dialog.value.okCallback = deleteFunction;
};

const saveFunction = () => {
  if (createNewFunction.value) {
    addFunctionRef.value.onSubmit();
  } else {
    emit("update:node", {
      data: { name: selectedFunction.value, order: functionOrder.value },
      link: nodeLink.value,
    });
  }
};

const onFunctionCreation = (_function: any) => {
  // Assing newly created function to the block
  emit("update:node", {
    data: { ..._function, order: functionOrder.value },
    link: nodeLink.value,
  });
};

const cancelFunctionCreation = () => {
  emit("cancel:hideform");
};

const saveUpdatedLink = (link: { from: string; to: string }) => {
  nodeLink.value = link;
};

const deleteFunction = () => {
  emit("delete:node", { data: props.functionData, type: "function" });
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
