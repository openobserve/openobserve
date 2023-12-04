import { reactive } from "vue";

// It is used to keep track of the current series name in tooltip to bold the series name
const getDefaultHoveredSeries: any = () => {
  return {
    hoveredSeriesName: "",
    panelId: -1,
    dataIndex: -1,
    seriesIndex: -1,
  };
};

const hoveredSeriesState: any = reactive({
  ...getDefaultHoveredSeries(),
});

const usehoveredSeriesState = () => {
  // set the current series name (will be set at chartrenderer on mouseover)
  const setHoveredSeriesName = (name: string) => {
    hoveredSeriesState.hoveredSeriesName = name ?? "";
  };

  const setIndex = (dataIndex: number, seriesIndex: number, panelId: any) => {
    hoveredSeriesState.dataIndex = dataIndex;
    hoveredSeriesState.seriesIndex = seriesIndex;
    hoveredSeriesState.panelId = panelId;
  };

  return {
    hoveredSeriesState,
    setHoveredSeriesName,
    setIndex,
  };
};

export default usehoveredSeriesState;
