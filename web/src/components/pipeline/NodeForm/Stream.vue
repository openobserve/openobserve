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
    size="lg"
    :show-close="true"
    @keydown.stop
    :form-id="createNewStream ? 'add-stream-node-form' : 'stream-node-form'"
    :primaryButtonLabel="t('alerts.save')"
    :secondaryButtonLabel="t('alerts.cancel')"
    :neutralButtonLabel="!createNewStream && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    data-test="input-node-stream-drawer"
    @click:secondary="handleSecondaryClick"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="add-stream-input-stream-routing-section"
      :class="'bg-surface-base'"
    >


    <div class="stream-routing-container w-full">
      <!-- Mode toggle — stays a bare UI control OUTSIDE the form: it swaps the
           select-existing form for the AddStream create child. -->
      <OSwitch
        v-if="selectedNodeType == 'input'"
        data-test="create-stream-toggle"
        :label="isUpdating ? 'Edit Stream' : 'Create new Stream'"
        v-model="createNewStream"
        class="mb-3"
      />

      <div>
        <OForm
          v-if="!createNewStream"
          id="stream-node-form"
          :form="form"
        >
          <div class="flex flex-col gap-3">
            <div data-test="input-node-stream-type-select" class="w-full">
              <OFormSelect
                name="stream_type"
                :options="(filteredStreamTypes as any)"
                :label="t('alerts.streamType')"
                required
                :searchable="false"
                data-test="input-node-stream-type-select"
              />
            </div>

            <div class="w-full">
              <OFormSelect
                name="stream_name"
                :options="indexOptions"
                :label="t('alerts.stream_name')"
                required
                :loading="isFetchingStreams"
                searchable
                :creatable="selectedNodeType === 'output'"
                @create="handleCreateStreamName"
                data-test="input-node-stream-name-select"
              />

              <OFormSwitch
                v-if="
                  formStreamType == 'enrichment_tables' &&
                  selectedNodeType == 'output'
                "
                name="appendData"
                :label="t('function.appendData')"
                class="mt-2"
              />
            </div>

            <div
              v-if="selectedNodeType == 'output'"
              class="note-message bg-banner-warning-bg text-banner-warning-text w-full rounded-default p-3 flex flex-col gap-2"
            >
              <div class="text-sm text-banner-warning-text">{{ t('alerts.guidelinesLabel') }}</div>
              <div class="flex flex-col gap-1 text-sm text-banner-warning-text">
                <div class="flex items-start gap-2">
                  <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                  <span>
                    {{ t('alerts.selectStreamGuideline') }}
                  </span>
                </div>
                <div class="flex items-start gap-2">
                  <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                  <span>
                    <span class="highlight font-bold text-text-link">{{ t('alerts.enrichmentTablesTerm') }}</span> {{ t('alerts.enrichmentTablesDestinationNote') }}
                  </span>
                </div>
                <div class="flex items-start gap-2">
                  <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                  <span>
                    {{ t('alerts.useCurlyBracesNote') }} <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">{}</span> {{ t('alerts.configureStreamNameDynamicNote') }}
                    <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- example stream-name pattern with placeholder syntax, must stay literal across locales -->
                    <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">static_text_{fieldname}_postfix</span>{{ t('alerts.staticTextBeforeAfterNote') }} <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">{}</span> {{ t('alerts.isOptionalNote') }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </OForm>
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
import { ref, onMounted, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ConfirmDialog from "../../ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import useStreams from "@/composables/useStreams";
import usePipelines from "@/composables/usePipelines";

import AddStream from "@/components/logstream/AddStream.vue";


import { defaultDestinationNodeWarningMessage } from "@/utils/pipelines/constants";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeStreamSchema, type StreamForm } from "./Stream.schema";

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
const indexOptions = ref<{ label: string; value: string; disabled: boolean }[]>([]);
const schemaList = ref([]);
const streams: any = ref({});
const usedStreams: any = ref([]);
const streamTypes = ["logs", "metrics", "traces"];
const outputStreamTypes = ["logs", "metrics", "traces", "enrichment_tables"];

// ── Seeds for the form's `:default-values` (edit prefill) ───────────────────
// Normalize any legacy object-shaped stream_name to a plain string.
const _existingStreamName = (pipelineObj.currentSelectedNodeData?.data as any)?.stream_name;
const streamNameSeed =
  typeof _existingStreamName === "string"
    ? _existingStreamName
    : typeof _existingStreamName === "object" && _existingStreamName
      ? _existingStreamName.value ?? _existingStreamName.label ?? ""
      : "";

const appendDataSeed =
  (pipelineObj.currentSelectedNodeData?.meta as { append_data?: string })
    ?.append_data == "true" || false;

const streamTypeSeed =
  (pipelineObj.currentSelectedNodeData?.data as { stream_type?: string })
    ?.stream_type || "logs";

const selectedNodeType = ref(
  (pipelineObj.currentSelectedNodeData as { io_type?: string })?.io_type || "",
);

// Typed dynamic (edit-prefill) defaults — read once at each OForm mount.
const streamDefaults = computed((): StreamForm => ({
  stream_type: streamTypeSeed,
  stream_name: streamNameSeed,
  appendData: appendDataSeed,
}));

// Rule ③ OWNER pattern: this component OWNS <OForm>, so it creates the form here
// with useOForm and hands it to <OForm :form="form">. The owner needs the live
// `stream_type` for the appendData `v-if` + the option-refetch/reset side effect,
// so it reads it reactively via form.useStore — a SINGLE source of truth (no
// hand-mirror, no store.subscribe).
const form = useOForm<StreamForm>({
  defaultValues: streamDefaults.value,
  schema: makeStreamSchema(t),
  onSubmit: (value) => onSubmit(value),
});

// Reactive read of the form-owned `stream_type` (drives the appendData `v-if`
// and the option-refetch) — a form.useStore view of the single source of truth,
// no mirror.
const formStreamType = form.useStore((s: any) => s.values.stream_type);

// Preserved cross-field side effect: on a REAL change of stream_type, reset the
// dependent stream_name and refetch the option list (the old form-store
// subscription's job). The watch's (new, prev) gives us the change directly —
// no manual sentinel. Guard against the initial seed fire (prev === undefined)
// so a prefilled stream_name isn't wiped on mount.
watch(
  form.useStore((s: any) => s.values.stream_type),
  (newType, prev) => {
    if (prev !== undefined && newType !== prev) {
      form.setFieldValue("stream_name", "", { dontUpdateMeta: true });
      getStreamList();
    }
  },
  // `sync` so the dependent stream_name reset lands immediately on the
  // stream_type change (the old form-store subscription was synchronous), before
  // any subsequent same-tick stream_name write.
  { flush: "sync" },
);

onMounted(async () => {
  if (pipelineObj.userSelectedNode) {
    pipelineObj.userSelectedNode = {};
  }
  // Show the loading state immediately so the stream-name select renders a
  // spinner instead of a transient "No options found" while the option list is
  // still being built.
  isFetchingStreams.value = true;
  // Reuse the used-streams request the editor already started on mount
  // (PipelineEditor stores the in-flight promise, then its resolved array, on
  // pipelineObj.usedStreams). `await` transparently handles both, so a node
  // drag never issues its own pipelines/streams request. Only fall back to a
  // fresh fetch if the editor hasn't kicked it off at all.
  usedStreams.value =
    pipelineObj.usedStreams != null
      ? await pipelineObj.usedStreams
      : await getUsedStreamsList();
  await getStreamList();
});

// Refetch the stream option list when the mode toggle flips (getStreamList on
// stream_type change is handled by the form-store subscription above).
watch(createNewStream, () => {
  getStreamList();
});
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
  const streamType = Object.prototype.hasOwnProperty.call(
    pipelineObj.currentSelectedNodeData.data,
    "stream_type",
  )
    ? pipelineObj.currentSelectedNodeData.data.stream_type
    : "logs";

  isFetchingStreams.value = true;

  try {
    const res: any = await getStreams(formStreamType.value, false);

    if (
      res.list.length > 0 &&
      Object.prototype.hasOwnProperty.call(
        pipelineObj.currentSelectedNodeData,
        "type",
      ) &&
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
  if (sanitized) form.setFieldValue("stream_name", sanitized);
};

const filteredStreamTypes = computed(() => {
  return selectedNodeType.value === "output" ? outputStreamTypes : streamTypes;
});

// Persist the stream node. Used by both the form's @submit (schema-validated
// values) and getLogStream (a stream just created via AddStream — already valid).
const persistStreamNode = (payload: {
  stream_type: string;
  stream_name: string;
  appendData?: boolean;
}) => {
  const streamNodeData: any = {
    stream_type: payload.stream_type,
    stream_name: payload.stream_name,
    org_id: store.state.selectedOrganization.identifier,
    node_type: "stream",
  };

  if (payload.stream_type == "enrichment_tables") {
    streamNodeData.meta = {
      append_data: (payload.appendData ?? false).toString(),
    };
  }

  addNode(streamNodeData);
  emit("cancel:hideform");
};

const getLogStream = async (data: any) => {
  data.name = data.name.replace(/-/g, "_");

  createNewStream.value = false;
  // The stream was just created via AddStream and is guaranteed valid — persist
  // the node directly (no form round-trip needed).
  persistStreamNode({
    stream_type: data.stream_type,
    stream_name: data.name,
  });
};

const dialog = ref({
  show: false,
  title: "",
  message: "",
  warningMessage: "",
  okCallback: () => {},
});

// Footer Cancel handler. In "Create new Stream" mode, Cancel just returns to the
// select-existing form (drawer stays open) — the same behavior AddStream's old
// inline Cancel had via @close. Otherwise it opens the discard-changes dialog.
const handleSecondaryClick = () => {
  if (createNewStream.value) {
    createNewStream.value = false;
  } else {
    openCancelDialog();
  }
};

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
    Object.prototype.hasOwnProperty.call(
      pipelineObj.currentSelectedNodeData?.data,
      "node_type",
    ) &&
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

// @submit handler — OForm only calls it once the schema passes (stream_type +
// stream_name required), so the schema gates the save (no manual guard).
const onSubmit = (value: StreamForm) => {
  persistStreamNode(value);
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
  handleSecondaryClick,
  openCancelDialog,
  openDeleteDialog,
  deleteNode,
  onSubmit,
  filterColumns,
  // Expose reactive variables for testing
  form,
  createNewStream,
  isUpdating,
  isFetchingStreams,
  indexOptions,
  schemaList,
  streams,
  usedStreams,
  formStreamType,
  selectedNodeType,
  filteredStreamTypes,
  dialog,
});
</script>

<style scoped>
/* keep(complex-state): :deep overrides of the nested add-stream form's internal
   structure (header row, nth input alignment, separators). */
.pipeline-add-stream {
  :deep(.add-stream-header.row) {
    display: none;
  }
  :deep(.add-stream-inputs :nth-child(5)) {
    justify-content: flex-start;
  }

  :deep([role="separator"]) {
    display: none !important;
  }
}
</style>
