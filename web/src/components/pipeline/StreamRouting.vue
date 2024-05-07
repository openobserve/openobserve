<template>
  <div
    data-test="add-stream-routing-section"
    class="full-width full-height"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md">
      {{ t("pipeline.routing") }}
    </div>
    <q-separator />

    <div class="stream-routing-container q-px-md q-pt-md q-pr-xl">
      <q-form @submit="saveRouting">
        <div
          data-test="stream-routing-name-input"
          class="o2-input"
          style="padding-top: 12px"
        >
          <q-input
            v-model="streamRoute.name"
            :label="t('function.stream_name') + ' *'"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            v-bind:readonly="isUpdating"
            v-bind:disable="isUpdating"
            :rules="[
              (val, rules) =>
                !!val
                  ? isValidStreamName ||
                    `Use alphanumeric and '+=,.@-_' characters only, without spaces.`
                  : t('common.nameRequired'),
            ]"
            tabindex="0"
            style="width: 480px"
            :error-message="
              streamRoute.name && isValidStreamName
                ? 'Stream name already exists'
                : ''
            "
            :error="!isValidName"
            @update:model-value="validateStreamName"
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
            data-test="stream-routing-cancel-btn"
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
            type="submit"
          />
          <q-btn
            v-if="isUpdating"
            data-test="stream-routing-delete-btn"
            :label="t('pipeline.deleteNode')"
            class="text-bold no-border q-ml-md"
            color="negative"
            padding="sm xl"
            no-caps
            @click="openDeleteDialog"
          />
        </div>
      </q-form>
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
import { computed, onMounted, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import RealTimeAlert from "../alerts/RealTimeAlert.vue";
import { getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useQuasar } from "quasar";

interface RouteCondition {
  column: string;
  operator: string;
  value: any;
  id: string;
}

interface StreamRoute {
  name: string;
  conditions: RouteCondition[];
}

const props = defineProps({
  streamName: {
    type: String,
    required: true,
  },
  streamType: {
    type: String,
    required: true,
  },
  editingRoute: {
    type: Object,
    required: false,
    default: () => null,
  },
  streamRoutes: {
    type: Object,
    required: true,
    default: () => ({}),
  },
});

const { t } = useI18n();

const q = useQuasar();

const router = useRouter();

const store = useStore();

const { getStream, getStreams } = useStreams();

const emit = defineEmits(["update:node", "cancel:hideform", "delete:node"]);

const isUpdating = ref(false);

const filteredColumns: any = ref([]);

const isFetchingStreams = ref(false);

const filteredStreams: Ref<any[]> = ref([]);

const streams: any = ref({});

const indexOptions = ref([]);

const originalStreamFields: Ref<any[]> = ref([]);

const isValidName: Ref<boolean> = ref(true);

let existingStreamNames: any;

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
    name: "",
    conditions: [{ column: "", operator: "", value: "", id: getUUID() }],
  };
};

onMounted(() => {
  if (props.editingRoute) {
    isUpdating.value = true;
    streamRoute.value = JSON.parse(
      JSON.stringify(props.editingRoute)
    ) as StreamRoute;
  }

  originalStreamRouting.value = JSON.parse(JSON.stringify(streamRoute.value));

  existingStreamNames = new Set(
    ...Object.values(props.streamRoutes).map((route: any) => route.name),
    props.streamName
  );

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

const isValidStreamName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(streamRoute.value.name);
});

const updateStreamFields = async () => {
  let streamCols: any = [];
  const streams: any = await getStream(
    props.streamName,
    props.streamType,
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

const closeDialog = () => {
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  if (
    JSON.stringify(originalStreamRouting.value) ===
    JSON.stringify(streamRoute.value)
  ) {
    closeDialog();
    return;
  }

  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel routing changes?";
  dialog.value.okCallback = closeDialog;
};

// TODO OK : Add check for duplicate routing name
const saveRouting = () => {
  isValidName.value = true;

  if (!isUpdating.value) validateStreamName();

  if (!isValidName.value) {
    return;
  }

  // Save routing
  emit("update:node", {
    data: {
      ...streamRoute.value,
      name: streamRoute.value.name,
    },
    link: nodeLink.value,
  });

  emit("cancel:hideform");
};

const saveUpdatedLink = (link: { from: string; to: string }) => {
  nodeLink.value = link;
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message = "Are you sure you want to delete stream routing?";
  dialog.value.okCallback = deleteRoute;
};

const deleteRoute = () => {
  emit("delete:node", {
    data: {
      ...props.editingRoute,
      name: props.editingRoute.name,
    },
    type: "streamRoute",
  });

  emit("delete:node", {
    data: {
      ...props.editingRoute,
      name: props.editingRoute.name + ":" + "condition",
    },
    type: "condition",
  });

  emit("cancel:hideform");
};

const validateStreamName = () => {
  isValidName.value = true;
  Object.values(props.streamRoutes).forEach((route: any) => {
    if (
      route.name === streamRoute.value.name ||
      route.name === props.streamName
    ) {
      isValidName.value = false;
    }
  });
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
