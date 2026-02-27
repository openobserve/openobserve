<template>
  <div ref="userGuideBtnRef">
    <q-btn
      no-caps
      @click="onUserGuideClick"
      padding="xs"
      class="q-ml-sm"
      flat
      icon="help_outline"
      data-test="cross-link-help-btn"
    >
      <q-tooltip class="bg-grey-8" anchor="bottom middle" self="top middle">
        User Guide
      </q-tooltip>
    </q-btn>
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
    <p>
      You can use the following variables in your URL template:
    </p>

    <div class="header">Field Information</div>
    <p>Reference the field that triggered the cross-link:</p>
    <ul>
      <li>
        <span class="bg-highlight">${field.__name}</span> – The field name
        (e.g., trace_id, kubernetes_namespace_name)
      </li>
      <li>
        <span class="bg-highlight">${field.__value}</span> – The value of that
        field from the record
      </li>
    </ul>

    <br />

    <div class="header">Time Range</div>
    <p>Reference the current selected time period:</p>
    <ul>
      <li>
        <span class="bg-highlight">${start_time}</span> – Start time (epoch
        milliseconds)
      </li>
      <li>
        <span class="bg-highlight">${end_time}</span> – End time (epoch
        milliseconds)
      </li>
    </ul>
    For Example:
    <span class="bg-highlight">from=${start_time}&to=${end_time}</span>

    <br />
    <br />

    <div class="header">Query</div>
    <p>Reference the current SQL query:</p>
    <ul>
      <li><span class="bg-highlight">${query}</span> – Current SQL query</li>
      <li>
        <span class="bg-highlight">${query_encoded}</span> – Base64-encoded SQL
        query
      </li>
    </ul>

    <br />

    <div class="header">Example</div>
    <p>
      <span class="bg-highlight"
        >https://example.com/trace/${field.__value}?from=${start_time}&to=${end_time}</span
      >
    </p>
  </div>
</template>

<script lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";

export default {
  name: "CrossLinkUserGuide",
  setup() {
    const store = useStore();
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
