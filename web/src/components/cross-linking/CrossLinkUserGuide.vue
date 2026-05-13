<template>
  <div ref="userGuideBtnRef">
    <OButton
      variant="ghost"
      size="icon-sm"
      class="q-ml-sm"
      @click="onUserGuideClick"
      data-test="cross-link-help-btn"
    >
      <HelpCircle class="tw:size-4" />
      <q-tooltip class="bg-grey-8" anchor="bottom middle" self="top middle">
        {{ t("crossLinks.userGuide") }}
      </q-tooltip>
    </OButton>
  </div>
  <div
    class="user-guide scroll o2-input"
    v-show="showUserGuide"
    style="
      position: fixed;
      z-index: 9999;
      width: 500px;
      max-height: 300px;
      border: 1px solid gray;
      border-radius: 5px;
    "
    @mouseleave="showUserGuide = false"
    :class="
      store.state.theme == 'dark'
        ? 'theme-dark bg-dark'
        : 'theme-light bg-white'
    "
    ref="userGuideDivRef"
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

    <br />

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
    {{ t("crossLinks.guideTimeExample") }}
    <span class="bg-highlight">from=${start_time}&amp;to=${end_time}</span>

    <br />
    <br />

    <div class="header">{{ t("crossLinks.guideQueryHeader") }}</div>
    <p>{{ t("crossLinks.guideQueryDesc") }}</p>
    <ul>
      <li><span class="bg-highlight">${query}</span> – {{ t("crossLinks.guideQuery") }}</li>
      <li>
        <span class="bg-highlight">${query_encoded}</span> – {{ t("crossLinks.guideQueryEncoded") }}
      </li>
    </ul>

    <br />

    <div class="header">{{ t("crossLinks.guideExampleHeader") }}</div>
    <p>
      <span class="bg-highlight"
        >https://example.com/trace/${field.__value}?from=${start_time}&amp;to=${end_time}</span
      >
    </p>
  </div>
</template>

<script lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from '@/lib/core/Button/OButton.vue';

export default {
  name: "CrossLinkUserGuide",
  components: { OButton, HelpCircle },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const showUserGuide = ref(false);

    const userGuideBtnRef: any = ref(null);
    const userGuideDivRef: any = ref(null);

    const onUserGuideClick = () => {
      if (userGuideBtnRef.value && userGuideDivRef.value) {
        userGuideDivRef.value.style.top =
          userGuideBtnRef.value.getBoundingClientRect().top + 32 + "px";

        userGuideDivRef.value.style.left =
          userGuideBtnRef.value.getBoundingClientRect().left + 48 + "px";
        showUserGuide.value = !showUserGuide.value;
      }
    };

    return {
      t,
      store,
      onUserGuideClick,
      showUserGuide,
      userGuideBtnRef,
      userGuideDivRef,
    };
  },
};
</script>

<style scoped lang="scss">
.user-guide {
  padding: 10px;
}
.header {
  font-weight: bold;
}

ul,
li,
p,
div {
  margin: 0;
}

.theme-dark .bg-highlight {
  background-color: #747474;
}

.theme-light .bg-highlight {
  background-color: #e7e6e6;
}
</style>
