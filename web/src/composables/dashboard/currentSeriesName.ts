import { reactive } from "vue";

// It is used to keep track of the current series name in tooltip to bold the series name
const getDefaultHoveredSeries: any = () => {
  return {
    hoveredSeriesName: "",
    hoveredSeriesValue: null,
    offsetX: 0,
    offsetY: 0,
    seriesId: "",
  };
};

const hoveredSeriesState: any = reactive({ ...getDefaultHoveredSeries() });

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

  return {
    hoveredSeriesState,
    setHoveredSeriesName,
    setHoveredSeriesValue,
    setOffset,
    setSeriesId,
    resetHoveredSeriesState,
  };
};

export default usehoveredSeriesState;
