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

import { useStore } from "vuex";
import { addLabelToPromQlQuery } from "@/utils/query/promQLUtils";
import { addLabelsToSQlQuery } from "@/utils/query/sqlUtils";
import { getStreamFromQuery } from "@/utils/query/sqlUtils";
import {
  formatInterval,
  formatRateInterval,
  getTimeInSecondsBasedOnUnit,
} from "@/utils/dashboard/variables/variablesUtils";
import { escapeSingleQuotes } from "@/utils/zincutils";

export class VariableManager {
  private currentDependentVariablesData: any[] = [];
  private currentDynamicVariablesData: any[] = [];
  private store = useStore();

  constructor(
    private panelSchema: any,
    private variablesData: any,
    private chartPanelRef: any,
  ) {
    this.updateCurrentVariablesData();
  }

  private updateCurrentVariablesData() {
    this.currentDependentVariablesData = this.variablesData?.value?.values
      ? JSON.parse(
          JSON.stringify(
            this.variablesData.value?.values
              ?.filter((it: any) => it.type != "dynamic_filters")
              ?.filter((it: any) => {
                const regexForVariable = new RegExp(
                  `.*\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?}?.*`,
                );
                return this.panelSchema.value.queries
                  ?.map((q: any) => regexForVariable.test(q?.query))
                  ?.includes(true);
              }),
          ),
        )
      : [];

    this.currentDynamicVariablesData = this.variablesData?.value?.values
      ? JSON.parse(
          JSON.stringify(
            this.variablesData.value?.values
              ?.filter((it: any) => it.type === "dynamic_filters")
              ?.map((it: any) => it?.value)
              ?.flat()
              ?.filter((it: any) => it?.operator && it?.name && it?.value),
          ),
        )
      : [];
  }

  getDependentVariablesData() {
    return this.variablesData.value?.values
      ?.filter((it: any) => it.type != "dynamic_filters")
      ?.filter((it: any) => {
        const regexForVariable = new RegExp(
          `.*\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?}?.*`,
        );
        return this.panelSchema.value.queries
          ?.map((q: any) => regexForVariable.test(q?.query))
          ?.includes(true);
      });
  }

  getDynamicVariablesData() {
    const sqlQueryStreams =
      this.panelSchema.value.queryType == "sql"
        ? this.panelSchema.value.queries.map((q: any) =>
            getStreamFromQuery(q.query),
          )
        : [];
    
    return this.variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      ?.flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);
  }

  shouldSkipSearchDueToEmptyVariables() {
    const allVars = [
      ...(this.getDependentVariablesData() || []),
      ...(this.getDynamicVariablesData() || []),
    ];

    const variablesToSkip = allVars
      .filter(
        (v) =>
          v.value === null ||
          v.value === undefined ||
          (Array.isArray(v.value) && v.value.length === 0),
      )
      .map((v) => v.name);

    return variablesToSkip.length > 0;
  }

  areDynamicVariablesStillLoading() {
    return this.variablesData.value?.values?.some(
      (it: any) =>
        it.type === "dynamic_filters" &&
        (it.isLoading || it.isVariableLoadingPending),
    );
  }

  areDependentVariablesStillLoadingWith(newDependentVariablesData: any) {
    return newDependentVariablesData?.some(
      (it: any) =>
        (it.value == null ||
          (Array.isArray(it.value) && it.value.length === 0)) &&
        (it.isLoading || it.isVariableLoadingPending),
    );
  }

  private areArraysEqual(array1: any, array2: any) {
    if (array1?.length !== array2?.length) {
      return false;
    }

    const sortedArray1 = array1?.slice()?.sort();
    const sortedArray2 = array2?.slice()?.sort();

    for (let i = 0; i < sortedArray1?.length; i++) {
      if (sortedArray1[i] !== sortedArray2[i]) {
        return false;
      }
    }

    return true;
  }

  private isAllRegularVariablesValuesSameWith(newDependentVariablesData: any) {
    return newDependentVariablesData.every((it: any) => {
      const oldValue = this.currentDependentVariablesData.find(
        (it2: any) => it2.name == it.name,
      );
      return it.multiSelect
        ? this.areArraysEqual(it.value, oldValue?.value)
        : it.value == oldValue?.value && oldValue?.value != "";
    });
  }

  private isAllDynamicVariablesValuesSameWith(newDynamicVariablesData: any) {
    return newDynamicVariablesData.every((it: any) => {
      const oldValue = this.currentDynamicVariablesData?.find(
        (it2: any) => it2.name == it.name,
      );
      return (
        oldValue?.value != "" &&
        it.value == oldValue?.value &&
        it.operator == oldValue?.operator
      );
    });
  }

  private updateCurrentDependentVariablesData(newDependentVariablesData: any) {
    this.currentDependentVariablesData = JSON.parse(
      JSON.stringify(newDependentVariablesData),
    );
  }

  private updateCurrentDynamicVariablesData(newDynamicVariablesData: any) {
    this.currentDynamicVariablesData = JSON.parse(
      JSON.stringify(newDynamicVariablesData),
    );
  }

  ifPanelVariablesCompletedLoading() {
    const newDynamicVariablesData = this.getDynamicVariablesData();
    
    if (this.areDynamicVariablesStillLoading()) {
      return false;
    }

    const newDependentVariablesData = this.getDependentVariablesData();
    
    if (this.areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      return false;
    }

    return true;
  }

  variablesDataUpdated() {
    const newDynamicVariablesData = this.getDynamicVariablesData();
    
    if (this.areDynamicVariablesStillLoading()) {
      return false;
    }

    const newDependentVariablesData = this.getDependentVariablesData();
    
    if (this.areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      return false;
    }

    if (
      newDependentVariablesData?.length !=
        this.currentDependentVariablesData?.length ||
      newDynamicVariablesData?.length != this.currentDynamicVariablesData?.length
    ) {
      this.updateCurrentDependentVariablesData(newDependentVariablesData);
      this.updateCurrentDynamicVariablesData(newDynamicVariablesData);
      return true;
    }

    if (
      !newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      return true;
    } else if (
      newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      const isAllRegularVariablesValuesSame =
        this.isAllRegularVariablesValuesSameWith(newDependentVariablesData);

      if (isAllRegularVariablesValuesSame) {
        return false;
      }

      this.updateCurrentDependentVariablesData(newDependentVariablesData);
      return true;
    } else if (
      !newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      const isAllDynamicVariablesValuesSame =
        this.isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);

      if (isAllDynamicVariablesValuesSame) {
        return false;
      }

      this.updateCurrentDynamicVariablesData(newDynamicVariablesData);
      return true;
    } else if (
      newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      const isAllRegularVariablesValuesSame =
        this.isAllRegularVariablesValuesSameWith(newDependentVariablesData);

      const isAllDynamicVariablesValuesSame =
        this.isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);

      if (isAllRegularVariablesValuesSame && isAllDynamicVariablesValuesSame) {
        return false;
      }

      this.updateCurrentDynamicVariablesData(newDynamicVariablesData);
      this.updateCurrentDependentVariablesData(newDependentVariablesData);
      return true;
    }

    return false;
  }

  replaceQueryValue(
    query: any,
    startISOTimestamp: any,
    endISOTimestamp: any,
    queryType: any,
  ) {
    const metadata: any[] = [];

    const scrapeInterval =
      this.store.state.organizationData.organizationSettings.scrape_interval ?? 15;

    const __interval =
      (endISOTimestamp - startISOTimestamp) /
      (this.chartPanelRef.value?.offsetWidth ?? 1000) /
      1000;

    const formattedInterval = formatInterval(__interval);

    const __rate_interval: any = Math.max(
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit,
      ) + scrapeInterval,
      4 * scrapeInterval,
    );

    const __interval_ms =
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit,
      ) * 1000;

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
    ];

    fixedVariables?.forEach((variable: any) => {
      const variableName = `$${variable.name}`;
      const variableNameWithBrackets = `\${${variable.name}}`;
      const variableValue = variable.value;
      
      if (
        query.includes(variableName) ||
        query.includes(variableNameWithBrackets)
      ) {
        metadata.push({
          type: "fixed",
          name: variable.name,
          value: variable.value,
        });
      }
      query = query.replaceAll(variableNameWithBrackets, variableValue);
      query = query.replaceAll(variableName, variableValue);
    });

    if (this.currentDependentVariablesData?.length) {
      this.currentDependentVariablesData?.forEach((variable: any) => {
        const variableName = `$${variable.name}`;
        const variableNameWithBrackets = `\${${variable.name}}`;

        let variableValue = "";
        if (Array.isArray(variable.value)) {
          const value =
            variable.value
              .map(
                (value: any) =>
                  `'${variable.escapeSingleQuotes ? escapeSingleQuotes(value) : value}'`,
              )
              .join(",") || "''";
          
          const possibleVariablesPlaceHolderTypes = [
            {
              placeHolder: `\${${variable.name}:csv}`,
              value: variable.value.join(","),
            },
            {
              placeHolder: `\${${variable.name}:pipe}`,
              value: variable.value.join("|"),
            },
            {
              placeHolder: `\${${variable.name}:doublequote}`,
              value:
                variable.value.map((value: any) => `"${value}"`).join(",") ||
                '""',
            },
            {
              placeHolder: `\${${variable.name}:singlequote}`,
              value: value,
            },
            {
              placeHolder: `\${${variable.name}}`,
              value: queryType === "sql" ? value : variable.value.join("|"),
            },
            {
              placeHolder: `\$${variable.name}`,
              value: queryType === "sql" ? value : variable.value.join("|"),
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
          variableValue =
            variable.value === null
              ? ""
              : `${variable.escapeSingleQuotes ? escapeSingleQuotes(variable.value) : variable.value}`;
          
          if (
            query.includes(variableName) ||
            query.includes(variableNameWithBrackets)
          ) {
            metadata.push({
              type: "variable",
              name: variable.name,
              value: variable.value,
            });
          }
          query = query.replaceAll(variableNameWithBrackets, variableValue);
          query = query.replaceAll(variableName, variableValue);
        }
      });

      return { query, metadata };
    } else {
      return { query, metadata };
    }
  }

  async applyDynamicVariables(query: any, queryType: any) {
    const metadata: any[] = [];
    const adHocVariables = this.variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      .flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);

    if (!adHocVariables?.length) {
      return { query, metadata };
    }

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
  }

  getCurrentDependentVariablesData() {
    return [...(this.getDependentVariablesData() || []), ...(this.getDynamicVariablesData() || [])];
  }
}
