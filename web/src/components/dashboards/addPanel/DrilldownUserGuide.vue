<template>
  <div ref="userGuideBtnRef">
    <OButton
      variant="ghost"
      size="icon"
      @click="onUserGuideClick"
      data-test="dashboard-drilldown-help-btn"
      icon-left="help-outline"
    >
      <OTooltip content="User Guide" side="bottom" align="center" />
    </OButton>
  </div>
  <Teleport to="body">
  <div
    class="user-guide p-[10px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.25)_rgba(0,0,0,0.05)]"
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
        ? 'theme-dark bg-[var(--color-surface-base,#1a1a1a)]'
        : 'theme-light bg-white'
    "
    @mouseleave="showUserGuide = false"
    ref="userGuideDivRef"
  >
    <p>
      In URL or while drilldown to another dashboard, you can use the following
      dynamic variables:
    </p>

    <div class="font-bold">Use current dashboard's variable</div>
    <p>You can reference a variable with the following format:</p>
    <ul>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${variable_name}</span>
        <br />
        (For Example, if your variable name is "test", you can use
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${test}</span>)
      </li>
    </ul>

    <br />

    <div class="font-bold">Use current query</div>
    <p>You can reference current query with the following format:</p>
    <ul>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${query}</span></li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${query_encoded}</span></li>
    </ul>
    <br />

    <div class="font-bold">Use current selected time period</div>
    <p>
      You can reference current selected Time period with the following format:
    </p>
    <ul>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${start_time}</span></li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${end_time}</span></li>
    </ul>
    For Example:
    <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">from=${start_time}&to=${end_time}</span>
    <br />
    <span class="font-bold">Note: </span>
    <span
      >Even with a relative time period, you can still use
      <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">start_time</span> and
      <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">end_time</span>.</span
    >
    <br />
    <br />
    <div class="font-bold">Use Series name and value</div>
    <p>You can reference the following variables to pass chart data:</p>

    <ul>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__name}</span> – The name of the
        series.
      </li>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__value}</span> – The numeric value
        of the data point.
      </li>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__axisValue}</span> – The value on
        the axis for the selected/clicked data point.
      </li>
    </ul>

    <br />

    <div class="font-bold">For table chart drilldown</div>
    <p>
      You can reference the row field and index with the following variables:
    </p>
    <ul>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'"
          >${row.field["field_label"]} or ${row.field.field_label}</span
        >
        <br />
        (For Example, if your want to use "test" column's value of clicked row,
        you can use <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${row.field.test} </span> or
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${row.field["test"]}</span>)
      </li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${row.index}</span></li>
    </ul>

    <br />

    <div class="font-bold">For Pie/Donut chart drilldown</div>
    <p>You can reference the series and value with the following variables:</p>
    <ul>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__name}</span></li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__value}</span></li>
    </ul>

    <br />

    <div class="font-bold">For Sankey chart drilldown</div>
    <p>
      You can reference the edge source, target, and value, as well as the node
      name and value, with the following variables:
    </p>
    <ul>
      <li class="font-bold">Edge</li>
      <ul>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${edge.__source}</span></li>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${edge.__target}</span></li>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${edge.__value}</span></li>
      </ul>
      <li class="font-bold">Node</li>
      <ul>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${node.__name}</span></li>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${node.__value}</span></li>
      </ul>
    </ul>
  </div>
  </Teleport>
</template>

<script lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default {
  components: { OButton, OTooltip },
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

<style scoped>
/* Override global transparent-by-default scrollbar so it is always visible */
.user-guide::-webkit-scrollbar {
  width: 6px;
}
.user-guide::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 3px;
}
.user-guide::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
}

.user-guide ul,
.user-guide li,
.user-guide p,
.user-guide div {
  margin: 0;
}
</style>
