<template>
  <div>
    <div
      data-test="add-alert-stream-type-select"
      class="alert-stream-type o2-input q-mr-sm q-mb-sm"
      style="padding-top: 0"
    >
      <q-select
        v-model="selectedParentNode"
        :options="parentNodes"
        :label="t('pipeline.SelectParentNode') + ' *'"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        stack-label
        outlined
        filled
        dense
        @update:model-value="updateChildNodes()"
        :rules="[(val: any) => !!val || 'Field is required!']"
        style="min-width: 220px"
      />
    </div>

    <div
      data-test="add-alert-stream-type-select"
      class="alert-stream-type o2-input q-mr-sm"
      style="padding-top: 0"
    >
      <q-select
        v-model="selectedChildNode"
        :options="childNodes"
        :label="t('pipeline.SelectChildNode') + ' *'"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        stack-label
        outlined
        filled
        dense
        style="min-width: 220px"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps({
  tree: {
    type: Array,
    required: true,
  },
});

const { t } = useI18n();

const parentNodes = ref([]);

const childNodes = ref([]);

const selectedParentNode = ref("");

const selectedChildNode = ref("");

const updateChildNodes = () => {
  // Update child nodes on parent node selection
};
</script>

<style lang="scss" scoped></style>
