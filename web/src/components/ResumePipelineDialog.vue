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
  <ODialog
    v-model:open="open"
    data-test="resume-pipeline-dialog"
    size="sm"
    :title="t('pipeline_list.resume_pipeline_title')"
    :sub-title="lastPausedAt ? `Last paused: ${convertUnixToDateFormat(lastPausedAt)}` : undefined"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('pipeline_list.run_pipeline')"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div class="flex w-78 flex-col gap-1.75">
      <ORadioGroup v-model="resumeFromStart">
        <ORadio class="items-center" :value="false">
          <template #label>
            <div class="resume-radio-label">
              <div class="resume-radio-main-text text-compact leading-4.5 font-normal">
                {{ t("confirmDialog.continueFromWherePaused") }}
              </div>
              <div
                v-if="lastPausedAt"
                class="resume-radio-sub-text h-4.5 text-xs leading-4.5 font-normal"
              >
                {{ convertUnixToDateFormat(lastPausedAt) }}.
              </div>
            </div>
          </template>
        </ORadio>
        <ORadio :value="true" style="height: 18px">
          <template #label>
            <span class="text-compact leading-4.5 font-normal">{{
              t("confirmDialog.startFromNow")
            }}</span>
          </template>
        </ORadio>
      </ORadioGroup>
    </div>
  </ODialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { convertUnixToDateFormat } from "@/utils/zincutils";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";

export default defineComponent({
  name: "ConfirmDialog",
  components: { ODialog, ORadio, ORadioGroup },
  emits: ["update:ok", "update:cancel", "update:shouldStartfromNow", "update:modelValue"],
  props: {
    title: { type: String },
    message: { type: String },
    lastPausedAt: { type: [Number, String] },
    shouldStartfromNow: { type: Boolean },
    modelValue: { type: Boolean, default: false },
  },
  setup(props, { emit }) {
    const { t } = useI18n();

    const open = computed({
      get: () => props.modelValue ?? false,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    const onCancel = () => {
      open.value = false;
      emit("update:cancel");
    };

    const onConfirm = () => {
      open.value = false;
      emit("update:ok");
    };

    const resumeFromStart = ref(props.shouldStartfromNow);
    watch(
      () => props.shouldStartfromNow,
      (val) => {
        resumeFromStart.value = val;
      },
    );
    watch(resumeFromStart, (val) => {
      emit("update:shouldStartfromNow", val);
    });

    return {
      t,
      open,
      onCancel,
      onConfirm,
      resumeFromStart,
      convertUnixToDateFormat,
    };
  },
});
</script>
