// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { addLabelToPromQlQuery } from "@/utils/query/promQLUtils";
import {
  addLabelsToSQlQuery,
  getStreamFromQuery,
} from "@/utils/query/sqlUtils";
import {
  formatInterval,
  formatRateInterval,
  getTimeInSecondsBasedOnUnit,
} from "@/utils/dashboard/variables/variablesUtils";
import { escapeSingleQuotes } from "@/utils/zincutils";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

/**
 * Composable that encapsulates all panel-level variable substitution logic.
 * Handles replacing $VAR tokens in queries, tracking variable snapshots,
 * and detecting when variables have changed enough to trigger a re-fetch.
 */
export const usePanelVariableSubstitution = ({
  panelSchema,
  variablesData,
  chartPanelRef,
  store,
  log,
}: {
  panelSchema: any;
  variablesData: any;
  chartPanelRef: any;
  store: any;
  log: (...args: any[]) => void;
}) => {
  // currently dependent variables data snapshot (mirrors the initialisation in usePanelDataLoader)
  let currentDependentVariablesData = variablesData?.value?.values
    ? JSON.parse(
        JSON.stringify(
          variablesData.value?.values
            ?.filter((it: any) => it.type != "dynamic_filters") // ad hoc filters are not considered as dependent filters as they are globally applied
            ?.filter((it: any) => {
              const regexForVariable = new RegExp(
                `(?:\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?\\}?)|(?:\\{\\{${it.name}(?::(csv|pipe|doublequote|singlequote))?\\}\\})`,
              );

              return panelSchema.value.queries
                ?.map((q: any) => regexForVariable.test(q?.query))
                ?.includes(true);
            }),
        ),
      )
    : [];

  let currentDynamicVariablesData = variablesData?.value?.values
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

  // Getters for the snapshots (used by the variables watcher in usePanelDataLoader)

  const getCurrentDependentVariablesData = () => currentDependentVariablesData;

  const getCurrentDynamicVariablesData = () => currentDynamicVariablesData;

  // Data accessors

  const getDependentVariablesData = () =>
    variablesData.value?.values
      ?.filter((it: any) => it.type != "dynamic_filters") // ad hoc filters are not considered as dependent filters as they are globally applied
      ?.filter((it: any) => {
        const regexForVariable = new RegExp(
          `(?:\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?\\}?)|(?:\\{\\{${it.name}(?::(csv|pipe|doublequote|singlequote))?\\}\\})`,
        );

        return panelSchema.value.queries
          ?.map((q: any) => regexForVariable.test(q?.query))
          ?.includes(true);
      });

  const getDynamicVariablesData = () => {
    const sqlQueryStreams =
      panelSchema.value.queryType == "sql"
        ? panelSchema.value.queries.map((q: any) => getStreamFromQuery(q.query))
        : [];
    const adHocVariables = variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      ?.flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);
    log("getDynamicVariablesData: adHocVariables", adHocVariables);
    return adHocVariables;
  };

  // Snapshot updaters

  const updateCurrentDependentVariablesData = (
    newDependentVariablesData: any,
  ) => {
    currentDependentVariablesData = JSON.parse(
      JSON.stringify(newDependentVariablesData),
    );
  };

  const updateCurrentDynamicVariablesData = (newDynamicVariablesData: any) => {
    currentDynamicVariablesData = JSON.parse(
      JSON.stringify(newDynamicVariablesData),
    );
  };

  // Loading-state checks

  const areDynamicVariablesStillLoading = () =>
    variablesData.value?.values?.some(
      (it: any) =>
        it.type === "dynamic_filters" &&
        (it.isLoading || it.isVariableLoadingPending),
    );

  const areDependentVariablesStillLoadingWith = (
    newDependentVariablesData: any,
  ) => {
    const result = newDependentVariablesData?.some((it: any) => {
      const hasNullValue = it.value == null;
      const hasEmptyArray = Array.isArray(it.value) && it.value.length === 0;

      // CRITICAL FIX: Only block if variable has NEVER been loaded (isVariablePartialLoaded=false)
      // If isVariablePartialLoaded=true but value=null, that's VALID (query returned no results)
      // Don't check isLoading or isVariableLoadingPending - those flags can be stale in committed state
      const hasNeverBeenLoaded = !it.isVariablePartialLoaded;

      // Block only if: (null/empty value) AND (never been loaded)
      const shouldBlock = (hasNullValue || hasEmptyArray) && hasNeverBeenLoaded;

      log(`[areDependentVariablesStillLoading] Variable ${it.name}:`, {
        value: it.value,
        hasNullValue,
        hasEmptyArray,
        isVariablePartialLoaded: it.isVariablePartialLoaded,
        hasNeverBeenLoaded,
        shouldBlock,
      });

      return shouldBlock;
    });

    log(`[areDependentVariablesStillLoading] Final result: ${result}`);
    return result;
  };

  // Value-change comparators

  const areArraysEqual = (array1: any, array2: any) => {
    // Check if both arrays have the same length
    if (array1?.length !== array2?.length) {
      return false;
    }

    // Sort both arrays
    const sortedArray1 = array1?.slice()?.sort();
    const sortedArray2 = array2?.slice()?.sort();

    // Compare sorted arrays element by element
    for (let i = 0; i < sortedArray1?.length; i++) {
      if (sortedArray1[i] !== sortedArray2[i]) {
        return false;
      }
    }

    // If all elements are equal, return true
    return true;
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

  const isAllDynamicVariablesValuesSameWith = (newDynamicVariablesData: any) =>
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

  // Orchestrators

  const ifPanelVariablesCompletedLoading = () => {
    // STEP 1: Check if there are any dynamic variables that are still loading
    log("Step1: checking if dynamic variables are loading, starting...");
    const newDynamicVariablesData = getDynamicVariablesData();

    if (areDynamicVariablesStillLoading()) {
      log("Step1: dynamic variables still loading..., returning false");
      return false;
    }

    // STEP 2: Check if any regular dependent variables are still loading

    log("Step2: checking if dependent variables are loading, starting...");

    const newDependentVariablesData = getDependentVariablesData();

    if (areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      log("Step2: regular variables still loading..., returning false");
      return false;
    }

    return true;
  };

  const variablesDataUpdated = () => {
    // STEP 1: Check if there are any dynamic variables that are still loading
    log("Step1: checking if dynamic variables are loading, starting...");
    const newDynamicVariablesData = getDynamicVariablesData();

    if (areDynamicVariablesStillLoading()) {
      log("Step1: dynamic variables still loading..., returning false");
      return false;
    }

    // STEP 2: Check if any regular dependent variables are still loading

    log("Step2: checking if dependent variables are loading, starting...");

    const newDependentVariablesData = getDependentVariablesData();

    if (areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      log("Step2: regular variables still loading..., returning false");
      return false;
    }

    // STEP 3: Check if any of the regular and dynamic variables count have changed
    // if count have changed, that means the variables are added or removed
    // so we need to fire the query
    log("Step3: checking if no of variables have changed, starting...");

    log(
      "Step3: newDependentVariablesData,",
      JSON.stringify(newDependentVariablesData, null, 2),
    );
    log(
      "Step3: newDynamicVariablesData...",
      JSON.stringify(newDynamicVariablesData, null, 2),
    );

    // if the length of the any of the regular and old dynamic data has changed,
    // we need to fire the query
    log(
      "Step3: newDependentVariablesData?.length",
      newDependentVariablesData?.length,
    );
    log(
      "Step3: newDynamicVariablesData?.length",
      newDynamicVariablesData?.length,
    );
    log(
      "Step3: currentDependentVariablesData?.length",
      currentDependentVariablesData?.length,
    );
    log(
      "Step3: currentAdHocVariablesData?.length",
      currentDynamicVariablesData?.length,
    );

    if (
      newDependentVariablesData?.length !=
        currentDependentVariablesData?.length ||
      newDynamicVariablesData?.length != currentDynamicVariablesData?.length
    ) {
      updateCurrentDependentVariablesData(newDependentVariablesData);
      updateCurrentDynamicVariablesData(newDynamicVariablesData);

      log(
        "Step3: length of the any of the regular and old dynamic data has changed, we need to fire the query",
      );
      return true;
    }

    log("Step3: finished...");
    // STEP 4: Now we know same number of variables are there and have updated,
    // we have to perform different action based on different combinations of variables types
    // 1. regular variables
    // 2. dynamic variables
    log("Step4: starting...");

    // now we have to check for different combinations for the count of regular and dynamic variables
    // 1. Regular variables  = 0 and Dynamic variables  = 0
    // 2. Regular variables >= 1 and Dynamic variables  = 0
    // 3. Regular variables  = 0 and Dynamic variables >= 1
    // 4. Regular variables >= 1 and Dynamic variables >= 1

    log(
      "Step4: newDependentVariablesData.length",
      newDependentVariablesData?.length,
    );
    log(
      "Step4: newDynamicVariablesData.length",
      newDynamicVariablesData?.length,
    );

    // execute different scenarios based on the count of variables
    if (
      !newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      // 1. Regular variables  = 0 and Dynamic variables  = 0
      // go ahead and bravly load the data
      !newDependentVariablesData?.length && !newDynamicVariablesData?.length;

      log(
        "Step4: 1: no variables are there, no waiting, can call the api, returning true...",
      );

      return true;
    } else if (
      newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      log("Step4: 2: Regular variables >= 1 and Dynamic variables  = 0");
      // 2. Regular variables >= 1 and Dynamic variables  = 0

      // log(
      //   "Step4: 2: checking against old values, currentDependentVariablesData",
      //   JSON.stringify(currentDependentVariablesData, null, 2)
      // );

      // check if the values have changed or not
      const isAllRegularVariablesValuesSame =
        isAllRegularVariablesValuesSameWith(newDependentVariablesData);

      if (isAllRegularVariablesValuesSame) {
        log("Step4: 2: regular variables has same old value, returning false");
        return false;
      }

      updateCurrentDependentVariablesData(newDependentVariablesData);

      log("Step4: 2: regular variables values has changed, returning true");
      return true;
    } else if (
      !newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      // 3. Regular variables  = 0 and Dynamic variables >= 1
      log("Step4: 3: Regular variables  = 0 and Dynamic variables >= 1");

      // check if dynamic variables are same or changed
      const isAllDynamicVariablesValuesSame =
        isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);

      // check if values are changed or not
      if (isAllDynamicVariablesValuesSame) {
        log("Step4: 3: dynamic variables has same old value, returning false");
        return false;
      }

      updateCurrentDynamicVariablesData(newDynamicVariablesData);

      log("Step4: 3: dynamic variables values has changed, returning true");
      return true;
    } else if (
      newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      // 4. Regular variables >= 1 and Dynamic variables >= 1
      log("Step4: 4: Regular variables >= 1 and Dynamic variables >= 1");

      // if any of the value has changed, we need to trigger the query
      // check if the values have changed or not
      const isAllRegularVariablesValuesSame =
        isAllRegularVariablesValuesSameWith(newDependentVariablesData);

      const isAllDynamicVariablesValuesSame =
        isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);

      log(
        "Step4: 4: isAllRegularVariablesValuesSame",
        isAllRegularVariablesValuesSame,
      );
      log(
        "Step4: 4: isAllDynamicVariablesValuesSame",
        isAllDynamicVariablesValuesSame,
      );

      // if any has changed
      if (isAllRegularVariablesValuesSame && isAllDynamicVariablesValuesSame) {
        log(
          "Step4: 4: regular and dynamic variables has same old value, returning false",
        );
        return false;
      }

      // values have changed
      // let's update and fire the query
      updateCurrentDynamicVariablesData(newDynamicVariablesData);
      updateCurrentDependentVariablesData(newDependentVariablesData);

      log("Step4: 4: variables values has changed, returning true");
      return true;
    }
  };

  // Query substitution

  /**
   * Replaces the query with the corresponding variable values.
   *
   * @param {any} query - The query to be modified.
   * @return {any} The modified query with replaced values.
   */
  const replaceQueryValue = (
    query: any,
    startISOTimestamp: any,
    endISOTimestamp: any,
    queryType: any,
  ) => {
    const metadata: any[] = [];

    //fixed variables value calculations
    //scrape interval by default 15 seconds
    const scrapeInterval =
      store.state.organizationData.organizationSettings.scrape_interval ?? 15;

    // timestamp in seconds / chart panel width
    const __interval =
      (endISOTimestamp - startISOTimestamp) /
      (chartPanelRef.value?.offsetWidth ?? 1000) /
      1000;

    // if less than 1, set it to 1
    // minimum will be 15000 millisecond
    // __interval = Math.max(15000, __interval);

    // round interval
    const formattedInterval = formatInterval(__interval);

    // calculate rate interval in seconds
    // we need formatted interval value in seconds
    const __rate_interval: any = Math.max(
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit,
      ) + scrapeInterval,
      4 * scrapeInterval,
    );

    //get interval in ms
    const __interval_ms =
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit,
      ) * 1000;

    // calculate range in seconds (total time range of the dashboard)
    // Note: startISOTimestamp and endISOTimestamp are in microseconds (from API)
    const __range_micros = endISOTimestamp - startISOTimestamp;
    const __range_seconds = __range_micros / 1000000; // Convert microseconds to seconds

    // format range, ensuring it's never empty (minimum 1s for PromQL compatibility)
    const formattedRange = formatRateInterval(__range_seconds) || "1s";

    const fixedVariables = [
      {
        name: "__interval_ms",
        value: `${__interval_ms}ms`,
      },
      {
        name: "__interval",
        value: `${formattedInterval.value}${formattedInterval.unit}`,
      },
      {
        name: "__rate_interval",
        value: `${formatRateInterval(__rate_interval)}`,
      },
      {
        name: "__range",
        value: formattedRange,
      },
      {
        name: "__range_s",
        value: `${Math.floor(__range_seconds)}`,
      },
      {
        name: "__range_ms",
        value: `${Math.floor(__range_seconds * 1000)}`,
      },
    ];

    // replace fixed variables with its values
    fixedVariables?.forEach((variable: any) => {
      // replace $VARIABLE_NAME, ${VARIABLE_NAME}, or {{VARIABLE_NAME}} with its value
      const variableName = `$${variable.name}`;
      const variableNameWithBrackets = `\${${variable.name}}`;
      const mustachePlaceholder = `{{${variable.name}}}`;
      const variableValue = variable.value;
      if (
        query.includes(variableName) ||
        query.includes(variableNameWithBrackets) ||
        query.includes(mustachePlaceholder)
      ) {
        metadata.push({
          type: "fixed",
          name: variable.name,
          value: variable.value,
        });
      }
      query = query.replaceAll(mustachePlaceholder, variableValue);
      query = query.replaceAll(variableNameWithBrackets, variableValue);
      query = query.replaceAll(variableName, variableValue);
    });

    if (currentDependentVariablesData?.length) {
      currentDependentVariablesData?.forEach((variable: any) => {
        // replace $VARIABLE_NAME or ${VARIABLE_NAME} with its value
        const variableName = `$${variable.name}`;
        const variableNameWithBrackets = `\${${variable.name}}`;

        let variableValue = "";
        if (Array.isArray(variable.value)) {
          // If no data found (empty array), use SELECT_ALL_VALUE
          const valueToUse =
            variable.value.length === 0 ? [SELECT_ALL_VALUE] : variable.value;
          const value =
            valueToUse
              .map(
                (value: any) =>
                  `'${variable.escapeSingleQuotes ? escapeSingleQuotes(value) : value}'`,
              )
              .join(",") || "''";
          const possibleVariablesPlaceHolderTypes = [
            // Mustache forms
            {
              placeHolder: `{{${variable.name}:csv}}`,
              value: valueToUse.join(","),
            },
            {
              placeHolder: `{{${variable.name}:pipe}}`,
              value: valueToUse.join("|"),
            },
            {
              placeHolder: `{{${variable.name}:doublequote}}`,
              value:
                valueToUse.map((value: any) => `"${value}"`).join(",") || '""',
            },
            {
              placeHolder: `{{${variable.name}:singlequote}}`,
              value: value,
            },
            {
              placeHolder: `{{${variable.name}}}`,
              value: queryType === "sql" ? value : valueToUse.join("|"),
            },
            // Dollar-sign forms (existing)
            {
              placeHolder: `\${${variable.name}:csv}`,
              value: valueToUse.join(","),
            },
            {
              placeHolder: `\${${variable.name}:pipe}`,
              value: valueToUse.join("|"),
            },
            {
              placeHolder: `\${${variable.name}:doublequote}`,
              value:
                valueToUse.map((value: any) => `"${value}"`).join(",") || '""',
            },
            {
              placeHolder: `\${${variable.name}:singlequote}`,
              value: value,
            },
            {
              placeHolder: `\${${variable.name}}`,
              value: queryType === "sql" ? value : valueToUse.join("|"),
            },
            {
              placeHolder: `\$${variable.name}`,
              value: queryType === "sql" ? value : valueToUse.join("|"),
            },
          ];

          possibleVariablesPlaceHolderTypes.forEach((placeHolderObj) => {
            if (query.includes(placeHolderObj.placeHolder)) {
              metadata.push({
                type: "variable",
                name: variable.name,
                value: placeHolderObj.value,
              });
            }
            query = query.replaceAll(
              placeHolderObj.placeHolder,
              placeHolderObj.value,
            );
          });
        } else {
          // If no data found (null value), use SELECT_ALL_VALUE
          const valueToUse =
            variable.value === null ? SELECT_ALL_VALUE : variable.value;
          variableValue = `${variable.escapeSingleQuotes ? escapeSingleQuotes(valueToUse) : valueToUse}`;
          const mustachePlaceholder = `{{${variable.name}}}`;
          if (
            query.includes(variableName) ||
            query.includes(variableNameWithBrackets) ||
            query.includes(mustachePlaceholder)
          ) {
            metadata.push({
              type: "variable",
              name: variable.name,
              value: valueToUse,
            });
          }
          query = query.replaceAll(mustachePlaceholder, variableValue);
          query = query.replaceAll(variableNameWithBrackets, variableValue);
          query = query.replaceAll(variableName, variableValue);
        }
      });

      return { query, metadata };
    } else {
      return { query, metadata };
    }
  };

  const applyDynamicVariables = async (query: any, queryType: any) => {
    const metadata: any[] = [];
    const adHocVariables = variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      .flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);

    if (!adHocVariables?.length) {
      return { query, metadata };
    }

    // continue if there are any adhoc queries
    if (queryType === "promql") {
      adHocVariables.forEach((variable: any) => {
        metadata.push({
          type: "dynamicVariable",
          name: variable.name,
          value: variable.value,
          operator: variable.operator,
        });

        query = addLabelToPromQlQuery(
          query,
          variable.name,
          variable.value,
          variable.operator,
        );
      });
    }

    if (queryType === "sql") {
      const queryStream = await getStreamFromQuery(query);

      const applicableAdHocVariables = adHocVariables;
      // .filter((it: any) => {
      //   return it?.streams?.find((it: any) => it.name == queryStream);
      // });

      applicableAdHocVariables.forEach((variable: any) => {
        metadata.push({
          type: "dynamicVariable",
          name: variable.name,
          value: variable.value,
          operator: variable.operator,
        });
      });
      query = await addLabelsToSQlQuery(query, applicableAdHocVariables);
    }

    return { query, metadata };
  };

  return {
    // Snapshot getters (needed by the variables watcher in usePanelDataLoader)
    getCurrentDependentVariablesData,
    getCurrentDynamicVariablesData,
    // Data accessors
    getDependentVariablesData,
    getDynamicVariablesData,
    // Snapshot updaters
    updateCurrentDependentVariablesData,
    updateCurrentDynamicVariablesData,
    // Loading-state checks
    areDynamicVariablesStillLoading,
    areDependentVariablesStillLoadingWith,
    // Value-change comparators
    areArraysEqual,
    isAllRegularVariablesValuesSameWith,
    isAllDynamicVariablesValuesSameWith,
    // Orchestrators
    ifPanelVariablesCompletedLoading,
    variablesDataUpdated,
    // Query substitution
    replaceQueryValue,
    applyDynamicVariables,
  };
};
