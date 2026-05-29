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
  <ODrawer
    :open="internalOpen"
    @update:open="handleDrawerClose"
    :title="t('pipeline.streamTitle')"
    size="md"
    :show-close="true"
    @keydown.stop
    :primaryButtonLabel="!createNewStream ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!createNewStream ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!createNewStream && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    data-test="input-node-stream-drawer"
    @click:primary="saveStream"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="add-stream-input-stream-routing-section"
      :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
    >


    <div class="stream-routing-container tw:w-full tw:py-3">
      <OSwitch
        v-if="selectedNodeType == 'input'"
        data-test="create-stream-toggle"
        :label="isUpdating ? 'Edit Stream' : 'Create new Stream'"
        v-model="createNewStream"
        class="tw:px-3 tw:mb-3"
      />

      <div>
        <div v-if="!createNewStream" class="tw:p-4 tw:flex tw:flex-col tw:gap-3">
          <div data-test="input-node-stream-type-select" class="tw:w-full">
            <OSelect
              v-model="stream_type"
              :options="(filteredStreamTypes as any)"
              :label="t('alerts.streamType') + ' *'"
              :searchable="false"
              @update:model-value="updateStreams()"
              data-test="input-node-stream-type-select"
            />
          </div>

          <div class="tw:w-full">
            <OSelect
              v-model="stream_name"
              :options="indexOptions"
              :label="t('alerts.stream_name') + ' *'"
              :loading="isFetchingStreams"
              searchable
              :creatable="selectedNodeType === 'output'"
              :error="!!streamNameError"
              :error-message="streamNameError"
              @update:model-value="streamNameError = ''"
              @create="handleCreateStreamName"
              data-test="input-node-stream-name-select"
            />

            <OSwitch
              v-if="
                stream_type == 'enrichment_tables' &&
                selectedNodeType == 'output'
              "
              v-model="appendData"
              :label="t('function.appendData')"
              class="tw:mt-2"
            />
          </div>

          <div
            v-if="selectedNodeType == 'output'"
            class="note-message tw:rounded-md tw:p-3 tw:flex tw:flex-col tw:gap-2"
          >
            <div class="tw:text-sm tw:text-gray-800">Guidelines:</div>
            <div class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-gray-800">
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                <span>
                  Select an existing stream from the list or enter the name to create a new one
                </span>
              </div>
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                <span>
                  <span class="highlight">Enrichment_tables</span> as destination stream is only available for scheduled pipelines
                </span>
              </div>
              <div class="tw:flex tw:items-start tw:gap-2">
                <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                <span>
                  Use curly braces <span class="code">{}</span> to configure stream name dynamically. e.g.
                  <span class="code">static_text_{fieldname}_postfix</span>. Static text before/after <span class="code">{}</span> is optional
                </span>
              </div>
            </div>
          </div>


        </div>
        <div v-else class="pipeline-add-stream">
          <AddStream
            ref="addStreamRef"
            @added:stream-added="getLogStream"
            @close="createNewStream = false"
            :is-in-pipeline="true"
          />
        </div>
      </div>
    </div>
  </div>
  </ODrawer>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    :warning-message="dialog.warningMessage"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>
<script lang="ts" setup>
import { ref, type Ref, onMounted, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ConfirmDialog from "../../ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import useStreams from "@/composables/useStreams";
import usePipelines from "@/composables/usePipelines";

import AddStream from "@/components/logstream/AddStream.vue";


import { defaultDestinationNodeWarningMessage } from "@/utils/pipelines/constants";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const emit = defineEmits(["cancel:hideform"]);

const internalOpen = ref(!!props.open);
watch(() => props.open, (v) => { internalOpen.value = !!v; });

function handleDrawerClose(v: boolean) {
  internalOpen.value = v;
  if (!v) {
    setTimeout(() => emit("cancel:hideform"), 300);
  }
}


const { t } = useI18n();

const store = useStore();

const {
  addNode,
  pipelineObj,
  deletePipelineNode,
  checkIfDefaultDestinationNode,
} = useDragAndDrop();
const { getUsedStreamsList } = usePipelines();

const { getStreams } = useStreams();

const createNewStream = ref(false);
const isUpdating = ref(false);
const isFetchingStreams = ref(false);
const streamNameError = ref("");
const indexOptions = ref<{ label: string; value: string; disabled: boolean }[]>([]);
const schemaList = ref([]);
const streams: any = ref({});
const usedStreams: any = ref([]);
const streamTypes = ["logs", "metrics", "traces"];
const outputStreamTypes = ["logs", "metrics", "traces", "enrichment_tables"];

// Normalize any legacy object-shaped stream_name to a plain string
const _existingStreamName = (pipelineObj.currentSelectedNodeData?.data as any)?.stream_name;
const stream_name = ref<string>(
  typeof _existingStreamName === "string"
    ? _existingStreamName
    : (typeof _existingStreamName === "object" && _existingStreamName
        ? (_existingStreamName.value ?? _existingStreamName.label ?? "")
        : ""),
);

const appendData = ref(
  (pipelineObj.currentSelectedNodeData?.meta as { append_data?: string })
    ?.append_data == "true" || false,
);

const stream_type = ref(
  (pipelineObj.currentSelectedNodeData?.data as { stream_type?: string })
    ?.stream_type || "logs",
);
const selectedNodeType = ref(
  (pipelineObj.currentSelectedNodeData as { io_type?: string })?.io_type || "",
);
onMounted(async () => {
  if (pipelineObj.userSelectedNode) {
    pipelineObj.userSelectedNode = {};
  }
  usedStreams.value = await getUsedStreamsList();
  await getStreamList();
});

watch(
  [stream_type, createNewStream],
  (
    [newStreamType, newCreateNewStream],
    [oldStreamType, oldCreateNewStream],
  ) => {
    if (newStreamType && newCreateNewStream == oldCreateNewStream) {
      // Only reset if createNewStream has changed
      stream_name.value = "";
    }
    getStreamList();
  },
);
function sanitizeStreamName(input: string): string {
  if (input.length > 100) {
    toast({
      message: "Stream name should be less than 100 characters",
      variant: "warning",
    });
    //return empty string so that stream name is not saved and user will be notifid and
    //will be able to add another stream name
    return "";
  }
  const regex = /\{[^{}]+\}/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    // Sanitize and add the static part before the dynamic part
    if (match.index > lastIndex) {
      const staticPart = input.slice(lastIndex, match.index);
      parts.push(...sanitizeStaticPart(staticPart));
    }

    // Push the dynamic part as-is
    parts.push(match[0]);

    lastIndex = regex.lastIndex;
  }

  // Sanitize and add the remaining static part (after the last dynamic part)
  if (lastIndex < input.length) {
    const staticPart = input.slice(lastIndex);
    parts.push(...sanitizeStaticPart(staticPart));
  }

  return parts.join("");
}

// Only sanitize non-dynamic parts
//this will convert all the characters that are not allowed in stream name to _
function sanitizeStaticPart(str: string): string[] {
  return str.split("").map((char) => (/[a-zA-Z0-9]/.test(char) ? char : "_"));
}


async function getStreamList() {
  const streamType = pipelineObj.currentSelectedNodeData.data.hasOwnProperty(
    "stream_type",
  )
    ? pipelineObj.currentSelectedNodeData.data.stream_type
    : "logs";

  isFetchingStreams.value = true;

  try {
    const res: any = await getStreams(stream_type.value, false);

    if (
      res.list.length > 0 &&
      pipelineObj.currentSelectedNodeData.hasOwnProperty("type") &&
      pipelineObj.currentSelectedNodeData.type === "input"
    ) {
      res.list.forEach((stream: any) => {
        stream.isDisable = usedStreams.value.some(
          (usedStream: any) =>
            usedStream.stream_name === stream.name &&
            usedStream.stream_type === stream.stream_type,
        );
      });
    }
    streams.value[streamType] = res.list;
    schemaList.value = res.list;
    indexOptions.value = res.list.map((stream: any) => ({
      label: stream.name,
      value: stream.name,
      disabled: stream.isDisable || false,
    }));
  } finally {
    isFetchingStreams.value = false;
  }
}
const updateStreams = () => {
  getStreamList();
};

const handleCreateStreamName = (val: string) => {
  val = val.replace(/-/g, "_");
  const sanitized = sanitizeStreamName(val);
  if (sanitized) stream_name.value = sanitized;
};

const filteredStreamTypes = computed(() => {
  return selectedNodeType.value === "output" ? outputStreamTypes : streamTypes;
});

const getLogStream = async (data: any) => {
  data.name = data.name.replace(/-/g, "_");

  stream_name.value = data.name;
  stream_type.value = data.stream_type;
  createNewStream.value = false;
  // Auto-associate the newly created stream and close the node form
  saveStream();
};

const dialog = ref({
  show: false,
  title: "",
  message: "",
  warningMessage: "",
  okCallback: () => {},
});

const openCancelDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.warningMessage = "";
  dialog.value.okCallback = () => emit("cancel:hideform");
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message = "Are you sure you want to delete stream association?";
  //here we will check if the destination node is added by default if yes then we will show a warning message to the user
  if (
    pipelineObj.currentSelectedNodeData?.data.hasOwnProperty("node_type") &&
    pipelineObj.currentSelectedNodeData?.data.node_type === "stream" &&
    checkIfDefaultDestinationNode(pipelineObj.currentSelectedNodeID)
  ) {
    dialog.value.warningMessage = defaultDestinationNodeWarningMessage;
  } else {
    dialog.value.warningMessage = "";
  }
  dialog.value.okCallback = deleteNode;
};

const deleteNode = () => {
  deletePipelineNode(pipelineObj.currentSelectedNodeID);
  emit("cancel:hideform");
};

const saveStream = () => {
  // Validate pipeline configuration

  const streamNodeData: any = {
    stream_type: stream_type.value,
    stream_name: stream_name.value,
    org_id: store.state.selectedOrganization.identifier,
    node_type: "stream",
  };

  if (stream_type.value == "enrichment_tables") {
    streamNodeData.meta = { append_data: appendData.value.toString() };
  }

  if (!stream_name.value) {
    streamNameError.value = t('validation.required');
    return;
  }
  streamNameError.value = '';
  addNode(streamNodeData);
  emit("cancel:hideform");
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
      (column: any) => column.toLowerCase().indexOf(value) > -1,
    );
  });
  return filteredOptions;
};

// Expose methods for testing
defineExpose({
  sanitizeStreamName,
  sanitizeStaticPart,
  getStreamList,
  updateStreams,
  handleCreateStreamName,
  getLogStream,
  openCancelDialog,
  openDeleteDialog,
  deleteNode,
  saveStream,
  filterColumns,
  // Expose reactive variables for testing
  createNewStream,
  isUpdating,
  isFetchingStreams,
  streamNameError,
  indexOptions,
  schemaList,
  streams,
  usedStreams,
  stream_name,
  appendData,
  stream_type,
  selectedNodeType,
  filteredStreamTypes,
  dialog,
});
</script>

<style>
.stream-routing-title {
  font-size: 18px;
  padding-top: 16px;
}
.pipeline-add-stream {
  .add-stream-header.row {
    display: none;
  }
  .add-stream-inputs :nth-child(5) {
    /* background-color: red; */
    justify-content: flex-start;
  }

  [role="separator"] {
    display: none !important;
  }
}
.q-field--labeled.showLabelOnTop.q-select
  .q-field__control-container
  .q-field__native
  > :first-child {
  text-transform: none !important;
  font-size: 0.875rem; /* Keep the font size and weight as needed */
  font-weight: 600;
}

.note-message {
  background-color: #f9f290;
  color: #2d3748;
  width: 100%;
}

.note-message .highlight {
  font-weight: bold;
  color: #007bff;
}

.note-message .code {
  font-family: monospace;
  padding: 1px 4px;
  border-radius: 3px;
  background-color: rgba(0, 0, 0, 0.06);
  color: #b30059;
}
</style>
