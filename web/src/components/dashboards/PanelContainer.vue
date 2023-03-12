<template>
  <div class="plotlycontainer">
    <div class="drag-allow">
      <PanelHeader
        :panelDataElement="props.data"
        :dashboardId="$route.query.dashboard"
        @clicked="onClickChild"
      />
    </div>
    <ChartRender
      :data="props.data"
      :selectedTimeDate="props.selectedTimeDate"
    ></ChartRender>
  </div>
</template>

<script  lang="ts">
import { defineComponent } from "vue";
import ChartRender from "./addPanel/ChartRender.vue";
import PanelHeader from "./PanelHeader.vue";

export default defineComponent({
  name: "PanelContainer",
  emits: ["updated:chart"],
  props: ["data", "selectedTimeDate"],
  components: {
    ChartRender,
    PanelHeader,
  },
  setup(props) {
    //get props data
    const getPanelDataElement = () => {
      return props.data;
    };
    return {
      props,
      getPanelDataElement,
    };
  },
  methods: {
    getDashboardId() {
      return this.$route.query.dashboard;
    },
    onClickChild(panelDataElementValue: any) {
      this.$emit("updated:chart", panelDataElementValue);
    },
  },
});
</script>

<style lang="scss" scoped>
.plotlycontainer {
  height: 100%;
}
</style>