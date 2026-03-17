// Copyright 2026 OpenObserve Inc.
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

// ================== FOR DEBUGGING PURPOSES ONLY ==================

import { watch } from "vue";

/**
 * Sets up a deep watcher on variablesData.values for debugging purposes.
 * The watcher returns immediately (no-op) ΓÇö remove the `return;` statement
 * to enable the detailed change logging when debugging is needed.
 */
export const useVariablesWatcher = (variablesData: any) => {
  // watch for changes in variablesData.values
  let previousValues: any[] = [];
  watch(
    () => variablesData.values,
    (newValues) => {
      return;
      // Track all changes to log them together
      const changes: any[] = [];

      // Compare each variable's properties
      newValues.forEach((newVar: any, index: number) => {
        const oldVar = previousValues[index];
        if (!oldVar) {
          changes.push({
            variable: newVar.name,
            type: "new_variable",
          });
          return;
        }

        // List of properties to watch
        const propertiesToWatch = [
          "value",
          "isLoading",
          "isVariablePartialLoaded",
          "isVariableLoadingPending",
          "options",
        ];

        // Check each property for changes
        const variableChanges: any = {
          name: newVar.name,
          changes: [],
        };

        propertiesToWatch.forEach((prop) => {
          // Get deep copies of values to avoid proxy objects
          const newValue = JSON.parse(JSON.stringify(newVar[prop]));
          const oldValue = JSON.parse(JSON.stringify(oldVar[prop]));

          // For arrays (like options) or objects, compare stringified versions
          const hasChanged =
            Array.isArray(newValue) || typeof newValue === "object"
              ? JSON.stringify(newValue) !== JSON.stringify(oldValue)
              : newValue !== oldValue;

          if (hasChanged) {
            variableChanges.changes.push({
              property: prop,
              from: oldValue,
              to: newValue,
            });
          }
        });

        if (variableChanges.changes.length > 0) {
          changes.push(variableChanges);
        }
      });

      // Log all changes together if there are any
      if (changes.length > 0) {
        console.group(`Variables changed at ${new Date().toISOString()}`);

        changes.forEach((change) => {
          if (change.type === "new_variable") {
            console.log(`≡ƒåò New variable added: ${change.variable}`);
          } else {
            console.groupCollapsed(`Variable: ${change.name}`);
            change.changes.forEach((propertyChange: any) => {
              console.log(
                `Property "${propertyChange.property}":`,
                "\nFrom:",
                typeof propertyChange.from === "object"
                  ? JSON.stringify(propertyChange.from, null, 2)
                  : propertyChange.from,
                "\nTo:",
                typeof propertyChange.to === "object"
                  ? JSON.stringify(propertyChange.to, null, 2)
                  : propertyChange.to,
              );
            });
            console.groupEnd();
          }
        });

        console.groupEnd();
      }

      // Store deep copy of current values for next comparison
      previousValues = JSON.parse(JSON.stringify(newValues));
    },
    { deep: true },
  );
};

export const variableLog = (_name: string, _message: string) => {
  // console.log(`[Variable: ${_name}] ${_message}`);
};

// ================== [END] FOR DEBUGGING PURPOSES ONLY ==================
