const defaultObject = {};

const useMetrics = () => {
  const resetSearchObj = () => {
    // delete searchObj.data;
    searchObj = reactive(Object.assign({}, defaultObject));
  };

  return { searchObj, resetSearchObj };
};
