import { reactive } from "vue";

// It is used to keep track of the current series name in tooltip to bold the series name
const getDefaultHoveredSeries: any = () => {
  return {
    hoveredSeriesName: "",
  };
};

const hoveredSeriesState: any = reactive({ ...getDefaultHoveredSeries() });

const usehoveredSeriesState = () => {
  // set the current series name (will be set at chartrenderer on mouseover)
  const setHoveredSeriesName = (name: string) => {
    hoveredSeriesState.hoveredSeriesName = name;
  };

  return {
    hoveredSeriesState,
    setHoveredSeriesName,
  };
};

export default usehoveredSeriesState;
