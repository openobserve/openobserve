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
    class="p-0 [min-height:inherit]"
   
    >
    <div>
      <div
        data-test="panel-layout-settings-height"
        class="o2-input"
      >
        <OForm id="panel-layout-settings-form" :form="form">
          <OFormInput class="min-w-55"
            name="h"
            :label="t('dashboard.panelHeight')"
            required
            type="number"
            data-test="panel-layout-settings-height-input"
          />
        </OForm>

        <div class="text-xs flex items-center gap-1 mt-1">
          <span class="whitespace-nowrap">{{ t('dashboard.approximately') }} <strong>{{ getRowCount }}</strong> {{ t('dashboard.tableRowsWillBeDisplayed') }}</span>
          <OIcon
            name="info-outline"
            class="cursor-pointer shrink-0"
            size="xs"
          />
            <OTooltip :content="t('dashboard.unitPixelHint')" />
        </div>


      </div>
    </div>
  </div>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../utils/zincutils";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
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

    const panelLayoutSettingsSchema = makePanelLayoutSettingsSchema(t);

    // OWNER pattern (rule ③): this component renders <OForm> and needs the live
    // height to compute the row-count preview, so it creates the form with
    // useOForm and reads it via form.useStore — ONE source of truth, no mirror.
    // Only `h` is editable; w/x/y/i are carried over from props.layout at submit.
    // @submit (baked in) fires only after the schema passes (required + > 0).
    const form = useOForm<PanelLayoutSettingsForm>({
      defaultValues: { h: props.layout?.h },
      schema: panelLayoutSettingsSchema,
      onSubmit: (value) => {
        emit("save:layout", { ...props.layout, h: Number(value.h) });
      },
    });

    // The form is owned here and the component persists across opens (the parent
    // toggles `:open`; its `v-if` is on the panel data, not cleared on close), so
    // reset on BOTH transitions: re-seed `h` on open, and clear submit-state +
    // errors on close so a failed submit's error doesn't linger on reopen.
    watch(
      () => props.open,
      () => {
        form.reset({ h: props.layout?.h });
      },
    );

    // "Approximately N table rows" preview tracks the typed height — read it
    // reactively from the form (rule ③: form.useStore, NOT a local copy).
    const liveHeight = form.useStore((s: any) => Number(s.values?.h ?? 0));

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
      form,
      getRowCount,
    };
  },
});
</script>
