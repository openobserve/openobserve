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
</template>
<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

const { t } = useI18n();
const router = useRouter();
const createPipeline = () => {
  router.push({ name: "pipelineEditor" });
};
</script>
<style lang=""></style>
