<template>
  <div>
    <template
      v-for="streamRoute in (streamRoutes as streamRoute[])"
      :key="streamRoute.name"
    >
      <div
        data-test="add-alert-name-input"
        class="alert-name-input o2-input"
        style="padding-top: 12px"
      >
        <q-input
          v-model="streamRoute.streamName"
          :label="t('alerts.name') + ' *'"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          v-bind:readonly="streamRoute.isUpdating"
          v-bind:disable="streamRoute.isUpdating"
          :rules="[(val: any) => !!val.trim() || 'Field is required!']"
          tabindex="0"
          style="min-width: 480px"
        />
      </div>
    </template>
  </div>
</template>
<script lang="ts" setup>
import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";

interface RouteCondition {
  column: string;
  value: any;
}

interface streamRoute {
  streamName: string;
  name: string;
  column: string;
  value: any;
  isUpdating: boolean;
}

const { t } = useI18n();

const streamRoutes: Ref<streamRoute | []> = ref([]);
</script>

<style scoped></style>
