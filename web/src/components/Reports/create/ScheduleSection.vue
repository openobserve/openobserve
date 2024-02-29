<template>
  <div class="q-my-sm q-px-sm">
    <!-- <div class="flex justify-start items-center q-py-sm">
              <q-icon name="event" class="q-mr-sm" />
              <div style="font-size: 14px">
                The report will be sent immediately after it is saved and will
                be sent every hour.
              </div>
            </div> -->
    <div style="font-size: 14px" class="text-bold text-grey-8 q-mb-sm">
      Frequency
    </div>
    <div
      style="border: 1px solid #d7d7d7; width: fit-content; border-radius: 2px"
    >
      <template v-for="visual in frequencyTabs" :key="visual.value">
        <q-btn
          :data-test="`edit-role-permissions-show-${visual.value}-btn`"
          :color="visual.value === formData.frequency ? 'primary' : ''"
          :flat="visual.value === formData.frequency ? false : true"
          dense
          no-caps
          size="12px"
          class="q-px-lg visual-selection-btn"
          style="padding-top: 4px; padding-bottom: 4px"
          @click="formData.frequency = visual.value"
        >
          {{ visual.label }}</q-btn
        >
      </template>
    </div>

    <div
      class="q-mt-md"
      style="border: 1px solid #d7d7d7; width: fit-content; border-radius: 2px"
    >
      <template v-for="visual in timeTabs" :key="visual.value">
        <q-btn
          :data-test="`edit-role-permissions-show-${visual.value}-btn`"
          :color="visual.value === selectedTimeTab ? 'primary' : ''"
          :flat="visual.value === selectedTimeTab ? false : true"
          dense
          no-caps
          size="12px"
          class="q-px-md visual-selection-btn"
          style="padding-top: 4px; padding-bottom: 4px"
          @click="selectedTimeTab = visual.value"
        >
          {{ visual.label }}</q-btn
        >
      </template>
    </div>

    <div
      v-if="formData.frequency === 'custom'"
      class="flex items-center justify-start q-mt-md"
    >
      <div
        data-test="add-alert-stream-select"
        class="o2-input q-mr-sm"
        style="padding-top: 0; width: 160px"
      >
        <q-input
          filled
          v-model="formData.custom_frequency.every"
          label="Repeat every"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          type="number"
          outlined
          dense
          style="width: 100%"
        />
      </div>

      <div
        data-test="add-alert-stream-select"
        class="o2-input"
        style="padding-top: 0; width: 160px"
      >
        <q-select
          v-model="formData.custom_frequency.frequency"
          :options="customFrequencyOptions"
          :label="' '"
          :popup-content-style="{ textTransform: 'capitalize' }"
          color="input-border"
          bg-color="input-bg"
          class="q-pt-sm q-pb-none showLabelOnTop no-case"
          filled
          emit-value
          stack-label
          dense
          behavior="menu"
          :rules="[(val: any) => !!val || 'Field is required!']"
          style="width: 100% !important"
        />
      </div>
    </div>

    <div
      v-if="selectedTimeTab === 'sendLater'"
      class="flex items-center justify-start q-mt-md"
    >
      <div class="o2-input q-mr-sm">
        <q-input
          filled
          v-model="formData.scheduling.date"
          label="Start Date"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          dense
          style="width: 160px"
        >
          <template v-slot:append>
            <q-icon name="event" class="cursor-pointer">
              <q-popup-proxy
                cover
                transition-show="scale"
                transition-hide="scale"
              >
                <q-date v-model="formData.scheduling.date" mask="YYYY-MM-DD">
                  <div class="row items-center justify-end">
                    <q-btn v-close-popup label="Close" color="primary" flat />
                  </div>
                </q-date>
              </q-popup-proxy>
            </q-icon>
          </template>
        </q-input>
      </div>
      <div class="o2-input q-mr-sm">
        <q-input
          filled
          v-model="formData.scheduling.time"
          label="Start Date"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          dense
          style="width: 160px"
        >
          <template v-slot:append>
            <q-icon name="access_time" class="cursor-pointer">
              <q-popup-proxy
                cover
                transition-show="scale"
                transition-hide="scale"
              >
                <q-time v-model="formData.scheduling.time" mask="HH:MM">
                  <div class="row items-center justify-end">
                    <q-btn v-close-popup label="Close" color="primary" flat />
                  </div>
                </q-time>
              </q-popup-proxy>
            </q-icon>
          </template>
        </q-input>
      </div>
      <div class="o2-input">
        <q-select
          data-test="datetime-timezone-select"
          v-model="formData.scheduling.timeZone"
          :options="filteredTimezone"
          @blur="
            timezone =
              timezone == ''
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : timezone
          "
          use-input
          @filter="timezoneFilterFn"
          input-debounce="0"
          dense
          filled
          emit-value
          fill-input
          hide-selected
          :label="t('logStream.timezone')"
          @update:modelValue="onTimezoneChange"
          :display-value="`Timezone: ${timezone}`"
          class="timezone-select showLabelOnTop"
          stack-label
          outlined
          style="width: 300px"
        />
      </div>
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
