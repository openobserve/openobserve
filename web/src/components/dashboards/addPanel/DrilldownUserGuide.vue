<template>
  <div ref="userGuideBtnRef">
    <OButton
      variant="ghost"
      size="icon"
      @click="onUserGuideClick"
      data-test="dashboard-drilldown-help-btn"
      icon-left="help-outline"
    >
      <q-tooltip class="bg-grey-8" anchor="bottom middle" self="top middle">
        User Guide
      </q-tooltip>
    </OButton>
  </div>
  <Teleport to="body">
  <div
    class="user-guide"
    v-show="showUserGuide"
    style="
      position: fixed;
      z-index: 9999;
      width: 500px;
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid gray;
      border-radius: 5px;
      pointer-events: auto;
    "
    :class="
      store.state.theme == 'dark'
        ? 'theme-dark bg-dark'
        : 'theme-light bg-white'
    "
    @mouseleave="showUserGuide = false"
    ref="userGuideDivRef"
  >
    <p>
      In URL or while drilldown to another dashboard, you can use the following
      dynamic variables:
    </p>

    <div class="header">Use current dashboard's variable</div>
    <p>You can reference a variable with the following format:</p>
    <ul>
      <li>
        <span class="bg-highlight">${variable_name}</span>
        <br />
        (For Example, if your variable name is "test", you can use
        <span class="bg-highlight">${test}</span>)
      </li>
    </ul>

    <br />

    <div class="header">Use current query</div>
    <p>You can reference current query with the following format:</p>
    <ul>
      <li><span class="bg-highlight">${query}</span></li>
      <li><span class="bg-highlight">${query_encoded}</span></li>
    </ul>
    <br />

    <div class="header">Use current selected time period</div>
    <p>
      You can reference current selected Time period with the following format:
    </p>
    <ul>
      <li><span class="bg-highlight">${start_time}</span></li>
      <li><span class="bg-highlight">${end_time}</span></li>
    </ul>
    For Example:
    <span class="bg-highlight">from=${start_time}&to=${end_time}</span>
    <br />
    <span class="header">Note: </span>
    <span
      >Even with a relative time period, you can still use
      <span class="bg-highlight">start_time</span> and
      <span class="bg-highlight">end_time</span>.</span
    >
    <br />
    <br />
    <div class="header">Use Series name and value</div>
    <p>You can reference the following variables to pass chart data:</p>

    <ul>
      <li>
        <span class="bg-highlight">${series.__name}</span> – The name of the
        series.
      </li>
      <li>
        <span class="bg-highlight">${series.__value}</span> – The numeric value
        of the data point.
      </li>
      <li>
        <span class="bg-highlight">${series.__axisValue}</span> – The value on
        the axis for the selected/clicked data point.
      </li>
    </ul>

    <br />

    <div class="header">For table chart drilldown</div>
    <p>
      You can reference the row field and index with the following variables:
    </p>
    <ul>
      <li>
        <span class="bg-highlight"
          >${row.field["field_label"]} or ${row.field.field_label}</span
        >
        <br />
        (For Example, if your want to use "test" column's value of clicked row,
        you can use <span class="bg-highlight">${row.field.test} </span> or
        <span class="bg-highlight">${row.field["test"]}</span>)
      </li>
      <li><span class="bg-highlight">${row.index}</span></li>
    </ul>

    <br />

    <div class="header">For Pie/Donut chart drilldown</div>
    <p>You can reference the series and value with the following variables:</p>
    <ul>
      <li><span class="bg-highlight">${series.__name}</span></li>
      <li><span class="bg-highlight">${series.__value}</span></li>
    </ul>

    <br />

    <div class="header">For Sankey chart drilldown</div>
    <p>
      You can reference the edge source, target, and value, as well as the node
      name and value, with the following variables:
    </p>
    <ul>
      <li class="header">Edge</li>
      <ul>
        <li><span class="bg-highlight">${edge.__source}</span></li>
        <li><span class="bg-highlight">${edge.__target}</span></li>
        <li><span class="bg-highlight">${edge.__value}</span></li>
      </ul>
      <li class="header">Node</li>
      <ul>
        <li><span class="bg-highlight">${node.__name}</span></li>
        <li><span class="bg-highlight">${node.__value}</span></li>
      </ul>
    </ul>
  </div>
  </Teleport>
</template>

<script lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";

export default {
  components: { OButton },
  name: "DrilldownUserGuide",
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
  overflow-y: auto;

  /* Override global transparent-by-default scrollbar so it is always visible */
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.25);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.05);
  }
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.25) rgba(0, 0, 0, 0.05);
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
