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
        class="tw:ml-2"
        data-test="cross-link-help-btn"
      >
        <OIcon name="help" size="sm" class="tw:size-4" />
        <OTooltip content="User Guide" side="bottom" align="center" />
      </OButton>
    </template>

    <div
      class="user-guide-body"
      :class="
        store.state.theme == 'dark'
          ? 'theme-dark tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]'
          : 'theme-light tw:bg-white'
      "
    >
      <p>{{ t("crossLinks.guideIntro") }}</p>

      <div class="header">{{ t("crossLinks.guideFieldHeader") }}</div>
      <p>{{ t("crossLinks.guideFieldDesc") }}</p>
      <ul>
        <li>
          <span class="bg-highlight">${field.__name}</span> – {{ t("crossLinks.guideFieldName") }}
        </li>
        <li>
          <span class="bg-highlight">${field.__value}</span> – {{ t("crossLinks.guideFieldValue") }}
        </li>
      </ul>

      <div class="header">{{ t("crossLinks.guideTimeHeader") }}</div>
      <p>{{ t("crossLinks.guideTimeDesc") }}</p>
      <ul>
        <li>
          <span class="bg-highlight">${start_time}</span> – {{ t("crossLinks.guideStartTime") }}
        </li>
        <li>
          <span class="bg-highlight">${end_time}</span> – {{ t("crossLinks.guideEndTime") }}
        </li>
      </ul>
      <p>
        {{ t("crossLinks.guideTimeExample") }}
        <span class="bg-highlight">from=${start_time}&amp;to=${end_time}</span>
      </p>

      <div class="header">{{ t("crossLinks.guideQueryHeader") }}</div>
      <p>{{ t("crossLinks.guideQueryDesc") }}</p>
      <ul>
        <li><span class="bg-highlight">${query}</span> – {{ t("crossLinks.guideQuery") }}</li>
        <li>
          <span class="bg-highlight">${query_encoded}</span> – {{ t("crossLinks.guideQueryEncoded") }}
        </li>
      </ul>

      <div class="header">{{ t("crossLinks.guideExampleHeader") }}</div>
      <p>
        <span class="bg-highlight"
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

<style scoped lang="scss">
.user-guide-body {
  width: 500px;
  max-height: 60vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  line-height: 1.4;

  p {
    margin: 0.25rem 0 0.5rem 0;
  }

  ul {
    margin: 0.25rem 0 0.75rem 1.25rem;
    padding: 0;

    li {
      margin: 0.25rem 0;
    }
  }
}

.header {
  font-weight: 600;
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
}

.bg-highlight {
  background-color: var(--o2-code-bg, #f1f5f9);
  padding: 0.0625rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
}
</style>
