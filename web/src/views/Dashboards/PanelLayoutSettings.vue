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
  <ODialog data-test="panel-layout-settings-drawer"
    :open="open"
    size="sm"
    :title="t('panel.layout')"
    :secondary-button-label="t('dashboard.cancel')"
    :primary-button-label="t('dashboard.save')"
    form-id="panel-layout-settings-form"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
  >
    <div
    data-test="panel-layout-settings-content"
    class="tw:p-0"
    :class="store.state.theme == 'dark' ? 'dark-mode' : 'tw:bg-white'"
    style="min-height: inherit"
  >
    <div>
      <div
        data-test="panel-layout-settings-height"
        class="o2-input"
      >
        <OForm
          id="panel-layout-settings-form"
          ref="panelFormRef"
          :schema="panelLayoutSettingsSchema"
          :default-values="panelLayoutSettingsDefaults"
          @submit="onSubmit"
        >
          <OFormInput
            name="h"
            :label="t('dashboard.panelHeight')"
            required
            type="number"
            style="min-width: 220px"
            data-test="panel-layout-settings-height-input"
          />
        </OForm>

        <div class="tw:text-[12px] tw:flex tw:items-center tw:gap-1 tw:mt-1">
          <span class="tw:whitespace-nowrap">Approximately <strong>{{ getRowCount }}</strong> table rows will be displayed</span>
          <OIcon
            name="info-outline"
            class="tw:cursor-pointer tw:shrink-0"
            size="xs"
           />
            <OTooltip content="1 unit = 30px" />
        </div>


      </div>
    </div>
  </div>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../utils/zincutils";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  makePanelLayoutSettingsSchema,
  type PanelLayoutSettingsForm,
} from "./PanelLayoutSettings.schema";
export default defineComponent({
  name: "PanelLayoutSettings",
  components: { ODialog, OForm, OFormInput, OTooltip,
    OIcon,
},
  props: {
    layout: {
      type: Object,
      required: true,
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["save:layout", "close", "update:open"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();

    const panelFormRef: any = ref(null);
    const panelLayoutSettingsSchema = makePanelLayoutSettingsSchema(t);

    // DYNAMIC (edit-prefill) defaults — the height is seeded from the existing
    // panel layout. The ODialog remounts the body on open, so this typed
    // computed re-seeds `h` each open. Only `h` is editable here; w/x/y/i are
    // carried over from props.layout at submit (they are not form fields).
    const panelLayoutSettingsDefaults = computed(
      (): PanelLayoutSettingsForm => ({
        h: props.layout?.h,
      }),
    );

    // The "Approximately N table rows" preview must track the height the user is
    // typing. `h` is now form-owned, so read it reactively from the form via
    // form.useStore (a snapshot would not re-render). The OForm body remounts on
    // each open, so re-subscribe whenever the form ref changes and dispose the
    // previous subscription.
    const liveHeight = ref<number>(Number(props.layout?.h ?? 0));
    let stopHeightWatch: (() => void) | null = null;
    watch(
      () => panelFormRef.value,
      (formRef: any) => {
        stopHeightWatch?.();
        stopHeightWatch = null;
        if (formRef?.form) {
          const heightStore = formRef.form.useStore((s: any) => s.values?.h);
          stopHeightWatch = watch(
            heightStore,
            (v: any) => {
              liveHeight.value = Number(v ?? 0);
            },
            { immediate: true },
          );
        } else {
          liveHeight.value = Number(props.layout?.h ?? 0);
        }
      },
      { immediate: true },
    );

    // @submit fires only after the schema passes (required + > 0). The validated
    // height merges back into the existing layout; the other layout members are
    // preserved unchanged.
    const onSubmit = (value: PanelLayoutSettingsForm) => {
      emit("save:layout", { ...props.layout, h: Number(value.h) });
    };

    const getRowCount = computed(() => {
      // 24 is the height of toolbar
      // 28.5 is the height of each "row"
      const count = Number(Math.ceil((liveHeight.value * 30 - 24) / 28.5));

      if (count < 0) return 0;

      return count;
    });

    return {
      t,
      store,
      router,
      getImageURL,
      panelFormRef,
      panelLayoutSettingsSchema,
      panelLayoutSettingsDefaults,
      onSubmit,
      getRowCount,
    };
  },
});
</script>

<style scoped lang="scss">
.dark-mode {
  background-color: $dark-page;
}
</style>
