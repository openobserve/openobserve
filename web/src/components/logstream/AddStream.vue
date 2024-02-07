<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="bg-white q-pt-md">
    <div class="row items-center no-wrap q-px-md">
      <div class="col">
        <div class="text-body1 text-bold" data-test="schema-title-text">
          {{ t("logStream.add") }}
        </div>
      </div>
      <div class="col-auto">
        <q-btn v-close-popup="true" round flat icon="close" />
      </div>
    </div>
    <q-separator class="q-my-md" />
    <div class="q-px-md o2-input add-stream-inputs">
      <q-form @submit="saveStream">
        <q-input
          v-model="streamInputs.name"
          :label="t('common.name') + ' *'"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val: any) => !!val.trim() || 'Field is required!']"
          tabindex="0"
          style="min-width: 480px"
        />

        <q-select
          v-model="streamInputs.stream_type"
          :options="streamTypes"
          :label="t('alerts.streamType') + ' *'"
          :popup-content-style="{ textTransform: 'capitalize' }"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop no-case"
          map-options
          stack-label
          emit-value
          outlined
          filled
          dense
          :rules="[(val: any) => !!val || 'Field is required!']"
          style="min-width: 220px"
        />

        <q-select
          v-model="streamInputs.index_type"
          :options="streamIndexType"
          :label="t('logStream.indexing') + ' *'"
          :popup-content-style="{ textTransform: 'capitalize' }"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          map-options
          stack-label
          outlined
          filled
          emit-value
          dense
          :rules="[(val: any) => !!val || 'Field is required!']"
          style="min-width: 220px"
        />

        <q-input
          v-model="streamInputs.retention_period"
          :label="t('logStream.dataRetention') + ' *'"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          type="number"
          :rules="[(val: any) => val > 0 || 'Field is required!']"
          style="min-width: 480px"
        />

        <div class="flex justify-end">
          <q-btn
            data-test="save-stream-btn"
            :label="t('logStream.createStream')"
            class="q-my-sm text-bold no-border"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const streamTypes = [
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" },
  { label: "Enrichment Table", value: "enrichment_tables" },
];

const streamIndexType = [
  { label: "Hash based partition", value: "hash" },
  { label: "Key based partition", value: "key" },
  { label: "Inverted index", value: "inverted" },
  { label: "Bloom filter", value: "bloom" },
];

const streamInputs = ref({
  name: "",
  stream_type: "",
  index_type: "",
  retention_period: 14,
});

const saveStream = () => {
  console.log("Stream Inputs", streamInputs.value);
};
</script>

<style lang="scss">
.add-stream-inputs {
  .q-field__label {
    font-weight: normal !important;
    font-size: 13px;
    transform: translate(-0.75rem, -155%);
    color: #3a3a3a;
    top: 12px !important;
  }
}
</style>
