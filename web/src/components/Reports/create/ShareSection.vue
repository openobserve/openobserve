<template>
  <div class="q-my-sm q-px-sm">
    <div data-test="add-report-name-input" class="report-name-input o2-input">
      <q-input
        v-model="formData.email_content.title"
        :label="t('reports.title') + ' *'"
        color="input-border"
        bg-color="input-bg"
        class="showLabelOnTop"
        stack-label
        outlined
        filled
        dense
        tabindex="0"
        style="width: 400px"
      />
    </div>

    <div data-test="add-report-name-input" class="report-name-input o2-input">
      <q-input
        v-model="formData.destination.recipients"
        :label="t('reports.recipients') + ' *'"
        color="input-border"
        bg-color="input-bg"
        class="showLabelOnTop"
        stack-label
        outlined
        filled
        dense
        tabindex="0"
        style="width: 100%"
        borderless
        :placeholder="t('user.inviteByEmail')"
      />
    </div>
    <div>
      <div style="font-size: 14px" class="text-bold text-grey-8">Message</div>
      <q-input
        v-model="formData.email_content.message"
        filled
        type="textarea"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";

const props = defineProps({
  formData: {
    type: Object,
    default: () => ({}),
  },
});

const { t } = useI18n();
</script>

<style scoped></style>
