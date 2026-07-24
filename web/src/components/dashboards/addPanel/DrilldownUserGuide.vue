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
      class="user-guide border-border-default rounded-default bg-surface-base pointer-events-auto fixed z-9999 max-h-75 w-125 overflow-y-auto border p-2.5 [scrollbar-color:color-mix(in_srgb,var(--color-grey-950)_25%,transparent)_color-mix(in_srgb,var(--color-grey-950)_5%,transparent)] [scrollbar-width:thin] [&_div]:m-0 [&_li]:m-0 [&_p]:m-0 [&_ul]:m-0"
      v-show="showUserGuide"
      @mouseleave="showUserGuide = false"
      ref="userGuideDivRef"
    >
      <p>
        In URL or while drilldown to another dashboard, you can use the following dynamic variables:
      </p>

      <div class="font-bold">Use current dashboard's variable</div>
      <p>You can reference a variable with the following format:</p>
      <ul>
        <li>
          <span class="bg-highlight-bg px-1.25">${variable_name}</span>
          <br />
          (For Example, if your variable name is "test", you can use
          <span class="bg-highlight-bg px-1.25">${test}</span>)
        </li>
      </ul>

      <br />

      <div class="font-bold">Use current query</div>
      <p>You can reference current query with the following format:</p>
      <ul>
        <li><span class="bg-highlight-bg px-1.25">${query}</span></li>
        <li><span class="bg-highlight-bg px-1.25">${query_encoded}</span></li>
      </ul>
      <br />

      <div class="font-bold">Use current selected time period</div>
      <p>You can reference current selected Time period with the following format:</p>
      <ul>
        <li><span class="bg-highlight-bg px-1.25">${start_time}</span></li>
        <li><span class="bg-highlight-bg px-1.25">${end_time}</span></li>
      </ul>
      For Example:
      <span class="bg-highlight-bg px-1.25">from=${start_time}&to=${end_time}</span>
      <br />
      <span class="font-bold">Note: </span>
      <span
        >Even with a relative time period, you can still use
        <span class="bg-highlight-bg px-1.25">start_time</span> and
        <span class="bg-highlight-bg px-1.25">end_time</span>.</span
      >
      <br />
      <br />
      <div class="font-bold">Use Series name and value</div>
      <p>You can reference the following variables to pass chart data:</p>

      <ul>
        <li>
          <span class="bg-highlight-bg px-1.25">${series.__name}</span> – The name of the series.
        </li>
        <li>
          <span class="bg-highlight-bg px-1.25">${series.__value}</span> – The numeric value of the
          data point.
        </li>
        <li>
          <span class="bg-highlight-bg px-1.25">${series.__axisValue}</span> – The value on the axis
          for the selected/clicked data point.
        </li>
      </ul>

      <br />

      <div class="font-bold">For table chart drilldown</div>
      <p>You can reference the row field and index with the following variables:</p>
      <ul>
        <li>
          <span class="bg-highlight-bg px-1.25"
            >${row.field["field_label"]} or ${row.field.field_label}</span
          >
          <br />
          (For Example, if your want to use "test" column's value of clicked row, you can use
          <span class="bg-highlight-bg px-1.25">${row.field.test} </span> or
          <span class="bg-highlight-bg px-1.25">${row.field["test"]}</span>)
        </li>
        <li><span class="bg-highlight-bg px-1.25">${row.index}</span></li>
      </ul>

      <br />

      <div class="font-bold">For Pie/Donut chart drilldown</div>
      <p>You can reference the series and value with the following variables:</p>
      <ul>
        <li><span class="bg-highlight-bg px-1.25">${series.__name}</span></li>
        <li><span class="bg-highlight-bg px-1.25">${series.__value}</span></li>
      </ul>

      <br />

      <div class="font-bold">For Sankey chart drilldown</div>
      <p>
        You can reference the edge source, target, and value, as well as the node name and value,
        with the following variables:
      </p>
      <ul>
        <li class="font-bold">Edge</li>
        <ul>
          <li><span class="bg-highlight-bg px-1.25">${edge.__source}</span></li>
          <li><span class="bg-highlight-bg px-1.25">${edge.__target}</span></li>
          <li><span class="bg-highlight-bg px-1.25">${edge.__value}</span></li>
        </ul>
        <li class="font-bold">Node</li>
        <ul>
          <li><span class="bg-highlight-bg px-1.25">${node.__name}</span></li>
          <li><span class="bg-highlight-bg px-1.25">${node.__value}</span></li>
        </ul>
      </ul>
    </div>
  </Teleport>
</template>

<script lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default {
  components: { OButton, OTooltip },
  name: "DrilldownUserGuide",
  setup() {
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
      onUserGuideClick,
      showUserGuide,
      userGuideBtnRef,
      userGuideDivRef,
    };
  },
};
</script>

<style scoped>
/* keep(scrollbar): ::-webkit-scrollbar pseudo-elements have no utility form.
   Overrides the global transparent-by-default scrollbar so it stays visible. */
.user-guide::-webkit-scrollbar {
  width: 0.375rem;
}
.user-guide::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 0.1875rem;
}
.user-guide::-webkit-scrollbar-track {
  background: var(--color-surface-subtle);
}
</style>
