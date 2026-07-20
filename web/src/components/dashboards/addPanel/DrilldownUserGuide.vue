<template>
  <div ref="userGuideBtnRef">
    <OButton
      variant="ghost"
      size="icon"
      @click="onUserGuideClick"
      data-test="dashboard-drilldown-help-btn"
      icon-left="help-outline"
    >
      <OTooltip :content="t('dashboard.drilldownUserGuide.userGuide')" side="bottom" align="center" />
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
        ? 'theme-dark bg-[var(--o2-bg-card-dark,#1a1a1a)]'
        : 'theme-light bg-white'
    "
    @mouseleave="showUserGuide = false"
    ref="userGuideDivRef"
  >
    <p>
      {{ t('dashboard.drilldownUserGuide.intro') }}
    </p>

    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.useCurrentDashboardVariable') }}</div>
    <p>{{ t('dashboard.drilldownUserGuide.referenceVariableFormat') }}</p>
    <ul>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${variable_name}</span>
        <br />
        {{ t('dashboard.drilldownUserGuide.variableExample') }}
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${test}</span>)
      </li>
    </ul>

    <br />

    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.useCurrentQuery') }}</div>
    <p>{{ t('dashboard.drilldownUserGuide.referenceCurrentQueryFormat') }}</p>
    <ul>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${query}</span></li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${query_encoded}</span></li>
    </ul>
    <br />

    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.useCurrentSelectedTimePeriod') }}</div>
    <p>
      {{ t('dashboard.drilldownUserGuide.referenceTimePeriodFormat') }}
    </p>
    <ul>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${start_time}</span></li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${end_time}</span></li>
    </ul>
    {{ t('dashboard.drilldownUserGuide.forExample') }}
    <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">from=${start_time}&to=${end_time}</span>
    <br />
    <span class="font-bold">{{ t('dashboard.drilldownUserGuide.note') }}</span>
    <span
      >{{ t('dashboard.drilldownUserGuide.relativeTimeNote') }}
      <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">start_time</span> {{ t('dashboard.drilldownUserGuide.and') }}
      <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">end_time</span>.</span
    >
    <br />
    <br />
    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.useSeriesNameAndValue') }}</div>
    <p>{{ t('dashboard.drilldownUserGuide.referenceChartDataFormat') }}</p>

    <ul>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__name}</span> {{ t('dashboard.drilldownUserGuide.seriesNameDesc') }}
      </li>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__value}</span> {{ t('dashboard.drilldownUserGuide.seriesValueDesc') }}
      </li>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__axisValue}</span> {{ t('dashboard.drilldownUserGuide.seriesAxisValueDesc') }}
      </li>
    </ul>

    <br />

    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.forTableChartDrilldown') }}</div>
    <p>
      {{ t('dashboard.drilldownUserGuide.referenceRowFieldIndex') }}
    </p>
    <ul>
      <li>
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'"
          >${row.field["field_label"]} or ${row.field.field_label}</span
        >
        <br />
        {{ t('dashboard.drilldownUserGuide.rowFieldExample') }}
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${row.field.test} </span> {{ t('dashboard.drilldownUserGuide.or') }}
        <span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${row.field["test"]}</span>)
      </li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${row.index}</span></li>
    </ul>

    <br />

    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.forPieDonutChartDrilldown') }}</div>
    <p>{{ t('dashboard.drilldownUserGuide.referenceSeriesValue') }}</p>
    <ul>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__name}</span></li>
      <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${series.__value}</span></li>
    </ul>

    <br />

    <div class="font-bold">{{ t('dashboard.drilldownUserGuide.forSankeyChartDrilldown') }}</div>
    <p>
      {{ t('dashboard.drilldownUserGuide.referenceSankey') }}
    </p>
    <ul>
      <li class="font-bold">{{ t('dashboard.drilldownUserGuide.edge') }}</li>
      <ul>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${edge.__source}</span></li>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${edge.__target}</span></li>
        <li><span class="bg-highlight" :class="store.state.theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'">${edge.__value}</span></li>
      </ul>
      <li class="font-bold">{{ t('dashboard.drilldownUserGuide.node') }}</li>
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
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default {
  components: { OButton, OTooltip },
  name: "DrilldownUserGuide",
  setup() {
    const { t } = useI18n();
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
