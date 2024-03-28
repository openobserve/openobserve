/**
 * Extract variable names from a string
 * @param {string} str - string to search for variable names
 * @param {Set<string>} variableNames - set of variable names to search for
 * @returns {string[]} - array of variable names found in the string
 */
const extractVariableNames = (
  str: string,
  variableNames: Set<string>
): string[] => {
  const regex = /\$(\w+)/g; // find all occurrences of $<variable_name>
  const names: string[] = [];
  let match: RegExpExecArray | null;
  // loop over all matches
  while ((match = regex.exec(str)) !== null) {
    // only include the variable name if it exists in the list of variables
    if (variableNames.has(match[1])) {
      names.push(match[1]);
    }
  }
  // remove duplicates by converting to a set and back to an array
  return Array.from(new Set(names));
};

/**
 * Build variables dependency graph
 * @param {array} variables - list of variables from the dashboard
 * @returns {object} graph - dictionary of variables names as keys and values are objects with two arrays:
 *  - parentVariables: list of variables that the key variable depends on
 *  - childVariables: list of variables that depend on the key variable
 */
export const buildVariablesDependencyGraph = (
  variables: { name: string; type: string; query_data: any }[]
) => {
  let graph: any = {};

  // Create a set of variable names
  let variablesNameList = new Set(
    variables.map((variable: { name: string }) => variable.name)
  );

  // Initialize the graph with empty arrays
  for (let item of variables) {
    // empty arrays for parent and child variables
    graph[item.name] = {
      parentVariables: [],
      childVariables: [],
    };
  }

  // Populate the graph
  for (let item of variables) {
    let name = item.name;
    if (item.type == "query_values") {
      for (let filter of item?.query_data?.filter ?? []) {
        let dependencies = extractVariableNames(
          filter.value,
          variablesNameList
        );
        // loop on all dependencies and append them as child
        dependencies.forEach((dep: any) => {
          graph[dep].childVariables.push(name);
        });

        // append all dependencies as parent
        graph[name].parentVariables.push(...dependencies);
      }
    } else {
      // no dependencies for non query_values variables
      graph[item.name] = {
        parentVariables: [],
        childVariables: [],
      };
    }
  }

  return graph;
};
