<template>
  <div ref="userGuideBtnRef">
    <OButton
      variant="ghost"
      size="icon"
      @click="onUserGuideClick"
      data-test="dashboard-drilldown-help-btn"
      icon-left="help-outline"
    >
      <OTooltip
        :content="t('dashboard.drilldownUserGuide.userGuide')"
        side="bottom"
        align="center"
      />
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
        {{ t("dashboard.drilldownUserGuide.intro") }}
      </p>

      <div class="font-bold">
        {{ t("dashboard.drilldownUserGuide.useCurrentDashboardVariable") }}
      </div>
      <p>{{ t("dashboard.drilldownUserGuide.referenceVariableFormat") }}</p>
      <ul>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${variable_name}</span>
          <br />
          {{ t("dashboard.drilldownUserGuide.variableExample") }}
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${test}</span>)
        </li>
      </ul>

      <br />

      <div class="font-bold">{{ t("dashboard.drilldownUserGuide.useCurrentQuery") }}</div>
      <p>{{ t("dashboard.drilldownUserGuide.referenceCurrentQueryFormat") }}</p>
      <ul>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${query}</span>
        </li>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${query_encoded}</span>
        </li>
      </ul>
      <br />

      <div class="font-bold">
        {{ t("dashboard.drilldownUserGuide.useCurrentSelectedTimePeriod") }}
      </div>
      <p>
        {{ t("dashboard.drilldownUserGuide.referenceTimePeriodFormat") }}
      </p>
      <ul>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${start_time}</span>
        </li>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${end_time}</span>
        </li>
      </ul>
      {{ t("dashboard.drilldownUserGuide.forExample") }}
      <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal URL query-string example, not translatable -->
      <span class="bg-highlight-bg px-1.25">from=${start_time}&to=${end_time}</span>
      <br />
      <span class="font-bold">{{ t("dashboard.drilldownUserGuide.note") }}</span>
      <span
        >{{ t("dashboard.drilldownUserGuide.relativeTimeNote") }}
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
        <span class="bg-highlight-bg px-1.25">start_time</span>
        {{ t("dashboard.drilldownUserGuide.and") }}
        <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
        <span class="bg-highlight-bg px-1.25">end_time</span>.</span
      >
      <br />
      <br />
      <div class="font-bold">
        {{ t("dashboard.drilldownUserGuide.useSeriesNameAndValue") }}
      </div>
      <p>{{ t("dashboard.drilldownUserGuide.referenceChartDataFormat") }}</p>

      <ul>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${series.__name}</span>
          {{ t("dashboard.drilldownUserGuide.seriesNameDesc") }}
        </li>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${series.__value}</span>
          {{ t("dashboard.drilldownUserGuide.seriesValueDesc") }}
        </li>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${series.__axisValue}</span>
          {{ t("dashboard.drilldownUserGuide.seriesAxisValueDesc") }}
        </li>
      </ul>

      <br />

      <div class="font-bold">
        {{ t("dashboard.drilldownUserGuide.forTableChartDrilldown") }}
      </div>
      <p>
        {{ t("dashboard.drilldownUserGuide.referenceRowFieldIndex") }}
      </p>
      <ul>
        <li>
          <!-- eslint-disable vue/no-bare-strings-in-template -- literal code syntax example for field access, not translatable -->
          <span class="bg-highlight-bg px-1.25"
            >${row.field["field_label"]} or ${row.field.field_label}</span
          >
          <!-- eslint-enable vue/no-bare-strings-in-template -->
          <br />
          {{ t("dashboard.drilldownUserGuide.rowFieldExample") }}
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${row.field.test} </span>
          {{ t("dashboard.drilldownUserGuide.or") }}
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${row.field["test"]}</span>)
        </li>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${row.index}</span>
        </li>
      </ul>

      <br />

      <div class="font-bold">
        {{ t("dashboard.drilldownUserGuide.forPieDonutChartDrilldown") }}
      </div>
      <p>{{ t("dashboard.drilldownUserGuide.referenceSeriesValue") }}</p>
      <ul>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${series.__name}</span>
        </li>
        <li>
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
          <span class="bg-highlight-bg px-1.25">${series.__value}</span>
        </li>
      </ul>

      <br />

      <div class="font-bold">
        {{ t("dashboard.drilldownUserGuide.forSankeyChartDrilldown") }}
      </div>
      <p>
        {{ t("dashboard.drilldownUserGuide.referenceSankey") }}
      </p>
      <ul>
        <li class="font-bold">{{ t("dashboard.drilldownUserGuide.edge") }}</li>
        <ul>
          <li>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
            <span class="bg-highlight-bg px-1.25">${edge.__source}</span>
          </li>
          <li>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
            <span class="bg-highlight-bg px-1.25">${edge.__target}</span>
          </li>
          <li>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
            <span class="bg-highlight-bg px-1.25">${edge.__value}</span>
          </li>
        </ul>
        <li class="font-bold">{{ t("dashboard.drilldownUserGuide.node") }}</li>
        <ul>
          <li>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
            <span class="bg-highlight-bg px-1.25">${node.__name}</span>
          </li>
          <li>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal template variable name shown as example, not translatable -->
            <span class="bg-highlight-bg px-1.25">${node.__value}</span>
          </li>
        </ul>
      </ul>
    </div>
  </Teleport>
</template>

<script lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";

export default {
  components: { OButton, OTooltip },
  name: "DrilldownUserGuide",
  setup() {
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
