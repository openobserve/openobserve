<template>
  <ODropdown
    v-model:open="showUserGuide"
    side="left"
    align="start"
    :side-offset="8"
  >
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-sm"
        class="ml-2"
        data-test="cross-link-help-btn"
      >
        <OIcon name="help" size="sm" class="size-4" />
        <OTooltip content="User Guide" side="bottom" align="center" />
      </OButton>
    </template>

    <div
      class="user-guide-body w-125 max-h-[60vh] overflow-y-auto overflow-x-hidden py-3 px-4 text-sm leading-[1.4]"
      :class="
        store.state.theme == 'dark'
          ? 'theme-dark bg-[var(--o2-bg-card-dark,#1a1a1a)]'
          : 'theme-light bg-white'
      "
    >
      <p>{{ t("crossLinks.guideIntro") }}</p>

      <div class="header font-semibold mt-3 mb-1">{{ t("crossLinks.guideFieldHeader") }}</div>
      <p>{{ t("crossLinks.guideFieldDesc") }}</p>
      <ul>
        <li>
          <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">${field.__name}</span> – {{ t("crossLinks.guideFieldName") }}
        </li>
        <li>
          <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">${field.__value}</span> – {{ t("crossLinks.guideFieldValue") }}
        </li>
      </ul>

      <div class="header font-semibold mt-3 mb-1">{{ t("crossLinks.guideTimeHeader") }}</div>
      <p>{{ t("crossLinks.guideTimeDesc") }}</p>
      <ul>
        <li>
          <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">${start_time}</span> – {{ t("crossLinks.guideStartTime") }}
        </li>
        <li>
          <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">${end_time}</span> – {{ t("crossLinks.guideEndTime") }}
        </li>
      </ul>
      <p>
        {{ t("crossLinks.guideTimeExample") }}
        <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">from=${start_time}&amp;to=${end_time}</span>
      </p>

      <div class="header font-semibold mt-3 mb-1">{{ t("crossLinks.guideQueryHeader") }}</div>
      <p>{{ t("crossLinks.guideQueryDesc") }}</p>
      <ul>
        <li><span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">${query}</span> – {{ t("crossLinks.guideQuery") }}</li>
        <li>
          <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]">${query_encoded}</span> – {{ t("crossLinks.guideQueryEncoded") }}
        </li>
      </ul>

      <div class="header font-semibold mt-3 mb-1">{{ t("crossLinks.guideExampleHeader") }}</div>
      <p>
        <span class="bg-highlight bg-(--o2-code-bg,#f1f5f9) py-px px-1 rounded font-mono text-[0.85em]"
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

<style>
.user-guide-body p {
  margin: 0.25rem 0 0.5rem 0;
}

.user-guide-body ul {
  margin: 0.25rem 0 0.75rem 1.25rem;
  padding: 0;
}

.user-guide-body ul li {
  margin: 0.25rem 0;
}
</style>
