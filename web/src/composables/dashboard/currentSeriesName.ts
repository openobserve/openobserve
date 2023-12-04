import { reactive } from "vue";

// It is used to keep track of the current series name in tooltip to bold the series name
const getDefaultHoveredSeries: any = () => {
  return {
    hoveredSeriesName: "",    // in use
    hoveredSeriesValue: null, // in use
    offsetX: 0,  // not in use
    offsetY: 0,  // not in use
    seriesId: "",  // in use
    panelId: -1,   // in use
  };
};

const hoveredSeriesState: any = reactive({
  ...getDefaultHoveredSeries(),
  flag: true,
  dataIndex: -1,
  seriesIndex: -1,
});

const usehoveredSeriesState = () => {
  // set the current series name (will be set at chartrenderer on mouseover)
  const setHoveredSeriesName = (name: string) => {
    hoveredSeriesState.hoveredSeriesName = name;
  };

  const setHoveredSeriesValue = (value: any) => {
    hoveredSeriesState.hoveredSeriesValue = value;
  };

  const setSeriesId = (seriesId: string) => {
    hoveredSeriesState.seriesId = seriesId ?? "";
  };

  const resetHoveredSeriesState = () => {
    Object.assign(hoveredSeriesState, { ...getDefaultHoveredSeries() });
  };

  const setOffset = (offsetX: number, offsetY: number) => {
    hoveredSeriesState.offsetX = offsetX;
    hoveredSeriesState.offsetY = offsetY;
  };

  const setIndex = (dataIndex: number, seriesIndex: number, panelId: any) => {
    console.log('setting index: ', dataIndex, seriesIndex);
    hoveredSeriesState.dataIndex = dataIndex;
    hoveredSeriesState.seriesIndex = seriesIndex;
    hoveredSeriesState.panelId = panelId;
  };

  const setPanelId = (panelId: number) => {
    panelId && (hoveredSeriesState.panelId = panelId);
  };

  return {
    hoveredSeriesState,
    setHoveredSeriesName,
    setHoveredSeriesValue,
    setOffset,
    setSeriesId,
    resetHoveredSeriesState,
    setIndex,
    setPanelId,
  };
};

export default usehoveredSeriesState;
