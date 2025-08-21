import { areArraysEqual } from "./panelDataLoaderUtils";

export const createVariablesManager = (
  panelSchema: any,
  variablesData: any,
  log: (...args: any[]) => void,
) => {
  let currentDependentVariablesData: any[] = variablesData?.value?.values
    ? JSON.parse(
        JSON.stringify(
          variablesData.value?.values
            ?.filter((it: any) => it.type != "dynamic_filters") // ad hoc filters are not considered as dependent filters as they are globally applied
            ?.filter((it: any) => {
              const regexForVariable = new RegExp(
                `.*\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?}?..*`,
              );

              return panelSchema.value.queries
                ?.map((q: any) => regexForVariable.test(q?.query))
                ?.includes(true);
            }),
        ),
      )
    : [];

  let currentDynamicVariablesData: any[] = variablesData?.value?.values
    ? JSON.parse(
        JSON.stringify(
          variablesData.value?.values
            ?.filter((it: any) => it.type === "dynamic_filters")
            ?.map((it: any) => it?.value)
            ?.flat()
            ?.filter((it: any) => it?.operator && it?.name && it?.value),
        ),
      )
    : [];

  const areDynamicVariablesStillLoading = () =>
    variablesData.value?.values?.some(
      (it: any) =>
        it.type === "dynamic_filters" &&
        (it.isLoading || it.isVariableLoadingPending),
    );

  const areDependentVariablesStillLoadingWith = (
    newDependentVariablesData: any,
  ) =>
    newDependentVariablesData?.some(
      (it: any) =>
        (it.value == null ||
          (Array.isArray(it.value) && it.value.length === 0)) &&
        (it.isLoading || it.isVariableLoadingPending),
    );

  const getDependentVariablesData = () =>
    variablesData.value?.values
      ?.filter((it: any) => it.type != "dynamic_filters")
      ?.filter((it: any) => {
        const regexForVariable = new RegExp(
          `.*\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?}?..*`,
        );

        return panelSchema.value.queries
          ?.map((q: any) => regexForVariable.test(q?.query))
          ?.includes(true);
      });

  const getDynamicVariablesData = () => {
    const adHocVariables = variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      ?.flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);
    log("getDynamicVariablesData: adHocVariables", adHocVariables);
    return adHocVariables;
  };

  const updateCurrentDependentVariablesData = (
    newDependentVariablesData: any,
  ) => {
    currentDependentVariablesData = JSON.parse(
      JSON.stringify(newDependentVariablesData),
    );
  };

  const updateCurrentDynamicVariablesData = (
    newDynamicVariablesData: any,
  ) => {
    currentDynamicVariablesData = JSON.parse(
      JSON.stringify(newDynamicVariablesData),
    );
  };

  const isAllRegularVariablesValuesSameWith = (
    newDependentVariablesData: any,
  ) =>
    newDependentVariablesData.every((it: any) => {
      const oldValue = currentDependentVariablesData.find(
        (it2: any) => it2.name == it.name,
      );
      return it.multiSelect
        ? areArraysEqual(it.value, oldValue?.value)
        : it.value == oldValue?.value && oldValue?.value != "";
    });

  const isAllDynamicVariablesValuesSameWith = (
    newDynamicVariablesData: any,
  ) =>
    newDynamicVariablesData.every((it: any) => {
      const oldValue = currentDynamicVariablesData?.find(
        (it2: any) => it2.name == it.name,
      );
      return (
        oldValue?.value != "" &&
        it.value == oldValue?.value &&
        it.operator == oldValue?.operator
      );
    });

  const ifPanelVariablesCompletedLoading = () => {
    const newDynamicVariablesData = getDynamicVariablesData();
    if (areDynamicVariablesStillLoading()) {
      return false;
    }
    const newDependentVariablesData = getDependentVariablesData();
    if (areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      return false;
    }
    return true;
  };

  const variablesDataUpdated = () => {
    const newDynamicVariablesData = getDynamicVariablesData();
    if (areDynamicVariablesStillLoading()) {
      return false;
    }
    const newDependentVariablesData = getDependentVariablesData();
    if (areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      return false;
    }
    if (
      newDependentVariablesData?.length !=
        currentDependentVariablesData?.length ||
      newDynamicVariablesData?.length != currentDynamicVariablesData?.length
    ) {
      updateCurrentDependentVariablesData(newDependentVariablesData);
      updateCurrentDynamicVariablesData(newDynamicVariablesData);
      return true;
    }

    if (!newDependentVariablesData?.length && !newDynamicVariablesData?.length) {
      return true;
    } else if (
      newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      const isAllRegularVariablesValuesSame =
        isAllRegularVariablesValuesSameWith(newDependentVariablesData);
      if (isAllRegularVariablesValuesSame) return false;
      updateCurrentDependentVariablesData(newDependentVariablesData);
      return true;
    } else if (
      !newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      const isAllDynamicVariablesValuesSame =
        isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);
      if (isAllDynamicVariablesValuesSame) return false;
      updateCurrentDynamicVariablesData(newDynamicVariablesData);
      return true;
    } else if (
      newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      const isAllRegularVariablesValuesSame =
        isAllRegularVariablesValuesSameWith(newDependentVariablesData);
      const isAllDynamicVariablesValuesSame =
        isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);
      if (isAllRegularVariablesValuesSame && isAllDynamicVariablesValuesSame)
        return false;
      updateCurrentDynamicVariablesData(newDynamicVariablesData);
      updateCurrentDependentVariablesData(newDependentVariablesData);
      return true;
    }
  };

  return {
    getDependentVariablesData,
    getDynamicVariablesData,
    areDynamicVariablesStillLoading,
    areDependentVariablesStillLoadingWith,
    isAllRegularVariablesValuesSameWith,
    isAllDynamicVariablesValuesSameWith,
    ifPanelVariablesCompletedLoading,
    variablesDataUpdated,
    getCurrentDependentVariablesData: () => currentDependentVariablesData,
    getCurrentDynamicVariablesData: () => currentDynamicVariablesData,
  };
};
