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
  <div
    class="q-pa-none"
    :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
    style="min-height: inherit"
  >
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="q-mx-md q-my-md text-h6">
          {{ t("panel.layout") }}
        </div>
      </div>
      <div class="col-auto">
        <q-btn
          v-close-popup="true"
          round
          flat
          :icon="'img:' + getImageURL('images/common/close_icon.svg')"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="q-mx-md">
      <div
        data-test="panel-layout-settings-height"
        class="o2-input"
        style="padding-top: 12px"
      >
        <q-input
          v-model="height"
          :label="t('dashboard.panelHeight') + ' *'"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          type="number"
          :rules="[(val: any) => !!val || t('common.nameRequired')]"
          style="min-width: 480px"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../utils/zincutils";

export default defineComponent({
  name: "PanelLayoutSettings",
  components: {},
  props: {
    layout: {
      type: Object,
      required: true,
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();

    const height = computed({
      get: () => props.layout.h,
      set: (value) => {
        emit("update:layout", { ...props.layout, h: value });
      },
    });

    return {
      t,
      store,
      router,
      height,
      getImageURL,
    };
  },
});
</script>

<style scoped lang="scss">
.dark-mode {
  background-color: $dark-page;
}
</style>
