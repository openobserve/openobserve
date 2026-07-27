<template>
  <ODropdown v-model:open="showUserGuide" side="left" align="start" :side-offset="8">
    <template #trigger>
      <OButton variant="ghost" size="icon-sm" class="ml-2" data-test="cross-link-help-btn">
        <OIcon name="help" size="sm" class="size-4" />
        <OTooltip content="User Guide" side="bottom" align="center" />
      </OButton>
    </template>

    <div
      class="user-guide-body bg-surface-base max-h-[60vh] w-125 overflow-x-hidden overflow-y-auto px-4 py-3 text-sm leading-[1.4]"
    >
      <p class="mt-1 mb-2">{{ t("crossLinks.guideIntro") }}</p>

      <div class="header mt-3 mb-1 font-semibold">{{ t("crossLinks.guideFieldHeader") }}</div>
      <p class="mt-1 mb-2">{{ t("crossLinks.guideFieldDesc") }}</p>
      <ul class="mt-1 mb-3 ml-5 p-0">
        <li class="my-1">
          <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
            >${field.__name}</span
          >
          – {{ t("crossLinks.guideFieldName") }}
        </li>
        <li class="my-1">
          <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
            >${field.__value}</span
          >
          – {{ t("crossLinks.guideFieldValue") }}
        </li>
      </ul>

      <div class="header mt-3 mb-1 font-semibold">{{ t("crossLinks.guideTimeHeader") }}</div>
      <p class="mt-1 mb-2">{{ t("crossLinks.guideTimeDesc") }}</p>
      <ul class="mt-1 mb-3 ml-5 p-0">
        <li class="my-1">
          <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
            >${start_time}</span
          >
          – {{ t("crossLinks.guideStartTime") }}
        </li>
        <li class="my-1">
          <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
            >${end_time}</span
          >
          – {{ t("crossLinks.guideEndTime") }}
        </li>
      </ul>
      <p class="mt-1 mb-2">
        {{ t("crossLinks.guideTimeExample") }}
        <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
          >from=${start_time}&amp;to=${end_time}</span
        >
      </p>

      <div class="header mt-3 mb-1 font-semibold">{{ t("crossLinks.guideQueryHeader") }}</div>
      <p class="mt-1 mb-2">{{ t("crossLinks.guideQueryDesc") }}</p>
      <ul class="mt-1 mb-3 ml-5 p-0">
        <li class="my-1">
          <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
            >${query}</span
          >
          – {{ t("crossLinks.guideQuery") }}
        </li>
        <li class="my-1">
          <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
            >${query_encoded}</span
          >
          – {{ t("crossLinks.guideQueryEncoded") }}
        </li>
      </ul>

      <div class="header mt-3 mb-1 font-semibold">{{ t("crossLinks.guideExampleHeader") }}</div>
      <p class="mt-1 mb-2">
        <span class="bg-highlight-bg rounded-default px-1.25 py-px font-mono text-[0.85em]"
          >https://example.com/trace/${field.__value}?from=${start_time}&amp;to=${end_time}</span
        >
      </p>
    </div>
  </ODropdown>
</template>

<script lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

export default {
  name: "CrossLinkUserGuide",
  components: { OButton, OTooltip, OIcon, ODropdown },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const showUserGuide = ref(false);

    return {
      t,
      store,
      showUserGuide,
    };
  },
};
</script>
