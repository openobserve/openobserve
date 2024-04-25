<template>
  <div>
    <div>
      <q-btn
        data-test="pipeline-list-create-btn"
        :label="t('pipeline.create')"
        class="text-bold no-border q-ml-md"
        color="secondary"
        padding="sm xl"
        no-caps
        @click="createPipeline"
      />
    </div>
  </div>
  <q-dialog v-model="showCreatePipeline" position="right" full-height maximized>
    <stream-selection @save="savePipeline" />
  </q-dialog>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import StreamSelection from "./StreamSelection.vue";
import pipelines from "@/services/pipelines";
import { useStore } from "vuex";

interface Pipeline {
  name: string;
  description: string;
  stream_type: string;
  stream_name: string;
}

const { t } = useI18n();
const router = useRouter();
const createPipeline = () => {
  showCreatePipeline.value = true;
};

const store = useStore();

const editPipeline = () => {
  router.push({ name: "pipelineEditor" });
};

const showCreatePipeline = ref(false);

const savePipeline = (data: Pipeline) => {
  console.log("data", data);
  pipelines
    .createPipeline({
      ...data,
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then(() => {
      showCreatePipeline.value = false;
    });
};
</script>
<style lang=""></style>
