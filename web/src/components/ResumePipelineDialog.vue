<!-- Copyright 2023 OpenObserve Inc.

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
  <q-dialog :class="store.state.theme === 'dark' ? 'dark-theme-dialog' : 'light-theme-dialog'">
    <q-card class="resume-pipeline-dialog" data-test="dialog-box">
      <q-card-section class="resume-pipeline-dialog-header q-pa-none" style="padding: 0px;">
        <div class="dialog-title">Resume Pipeline Ingestion</div>
        <div v-if="lastPausedAt" class="last-paused-at-text">Last paused: {{ convertUnixToQuasarFormat(lastPausedAt) }}</div>
      </q-card-section>
      <q-card-section class="resume-pipeline-dialog-body q-pa-none" style="padding: 0px;">
              <q-radio
              v-model="resumeFromStart"
              class="resume-radio-align"
              :val="false">
                <div class="resume-radio-label">
                <div class="resume-radio-main-text resume-pipeline-dialog-body-text" >Continue from where it paused</div>
                <div v-if="lastPausedAt" class="resume-radio-sub-text resume-pipeline-dialog-body-text-time">
                  {{ convertUnixToQuasarFormat(lastPausedAt) }}.
                </div>
              </div>
            </q-radio>
            <q-radio
              v-model="resumeFromStart"
              :val="true"
              style="height: 18px;"
            >
              <span class="resume-pipeline-dialog-body-text">Start from now.</span>
            </q-radio>
      </q-card-section>

      <q-card-actions class="resume-pipeline-dialog-actions q-pa-none tw:flex tw:justify-center" style="padding: 0px;">
        <q-btn
          v-close-popup
          unelevated
          no-caps
          class="o2-secondary-button"
          dense
          @click="onCancel"
          data-test="cancel-button"
        >
          {{ t("confirmDialog.cancel") }}
        </q-btn>
        <q-btn
          v-close-popup
          unelevated
          no-caps
          @click="onConfirm"
          dense
          data-test="confirm-button"
          class="o2-primary-button"
        >
        {{ t('pipeline_list.run_pipeline') }}
        </q-btn>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { convertUnixToQuasarFormat } from "@/utils/zincutils";

export default defineComponent({
  name: "ConfirmDialog",
  emits: ["update:ok", "update:cancel", "update:shouldStartfromNow"],
  props: ["title", "message", "lastPausedAt", "shouldStartfromNow","lastPausedAt"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      emit("update:ok");
    };
    const resumeFromStart = ref(props.shouldStartfromNow);
    watch(
        () => props.shouldStartfromNow,
        (val) => {
          resumeFromStart.value = val
        }
      )
      watch(resumeFromStart, (val) => {
        emit('update:shouldStartfromNow', val)
      })
    return {
      t,
      onCancel,
      onConfirm,
      resumeFromStart,
      store,
      convertUnixToQuasarFormat
    };
  },
});
</script>

<style lang="scss" scoped>
.resume-pipeline-dialog {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 8px;
  align-items: flex-start;
  border-radius: 4px;
}
.resume-pipeline-dialog-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0px;
  gap: 2px;
}
.resume-pipeline-dialog-body{
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 312px;
  .q-radio{
    margin-left: -8px;
    ::v-deep(.q-radio__inner){
      min-height: 16px !important;
      height: 24px !important;
      width: 24px !important;
      min-width: 16px !important;
      
    }
  }
}

.dialog-title{
  font-size: 14px;
  font-weight: 600;
  height: 18px;
}
.last-paused-at-text{
  font-size: 12px;
  height: 18px;
  font-weight: 400;
}
.resume-pipeline-dialog-body-text{
  font-size: 13px;
  line-height: 18px;
  font-weight: 400;

}
.resume-pipeline-dialog-body-text-time{
font-size: 12px;
  line-height: 18px;
  font-weight: 400;

}

.resume-pipeline-dialog-actions{
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-top: 4px;
  .q-btn{
    font-size: 12px;
    height: 28px;
    border-radius: 2px;
    width: fit-content;
    :v-deep(.q-btn__content){
      height: 20px !important;
      min-height: 20px !important;
      padding: 0px !important;
      font-size: 12px !important;
      background-color: red !important;
    }
  }
}

.resume-pipeline-dialog-body-text-time{
  height: 18px;

}

//light theme
.light-theme-dialog{
  .dialog-title{
    color: #000;
  }
  .last-paused-at-text{
    color: #595959;
  }
  .resume-pipeline-dialog{
    box-shadow: 0px 2px 11px rgba(0, 0, 0, 0.25);
  }
  .resume-pipeline-dialog-body-text-time{
    color: rgba(89, 89, 89, 1);
  }
}
//dark-theme
.dark-theme-dialog{
  .dialog-title{
    color: #fff;
  }
  .last-paused-at-text{
    color: #999999;
  }
  .resume-pipeline-dialog{
    box-shadow: 0px 2px 6px rgba(255, 255, 255, 0.15);
  }
  .resume-pipeline-dialog-body-text-time{
    color: rgba(153, 153, 153, 1);
  }
}
.resume-radio-align {
  align-items: flex-center; /* aligns radio button with top of the label */
}
</style>
