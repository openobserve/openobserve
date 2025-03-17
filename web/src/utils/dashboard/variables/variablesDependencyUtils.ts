/**
 * Extract variable names from a string
 * @param {string} str - string to search for variable names
 * @param {Set<string>} variableNames - set of variable names to search for
 * @returns {string[]} - array of variable names found in the string
 */
const extractVariableNames = (
  str: string,
  variableNames: Set<string>,
): string[] => {
  const regex = /\$([a-zA-Z0-9_-]+)/g; // find all occurrences of $<variable_name>
  const names: string[] = [];
  let match: RegExpExecArray | null;
  // loop over all matches
  while ((match = regex.exec(str)) !== null) {
    // match[0]: This will log: $a-k8s_namespace_name
    // match[1]: This will log: a-k8s_namespace_name
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
/**
 * Extracts variable names from a string value
 * @param value The string value to extract variable names from
 * @param variablesList Set of all valid variable names
 * @returns Array of extracted variable names
 */

/**
 * Builds a dependency graph for variables
 * @param variables Array of variable objects
 * @returns Graph representation of variable dependencies
 */
export const buildVariablesDependencyGraph = (
  variables: {
    name: string;
    type?: string;
    query_data?: any;
    scope?: string;
  }[],
) => {
  // Create a set of variable names for quick lookup
  const variableNameSet = new Set(variables.map((variable) => variable.name));

  // Initialize the graph with empty arrays and scope information
  const graph: {
    [key: string]: {
      parentVariables: string[];
      childVariables: string[];
      scope: string;
    };
  } = {};

  // First pass: initialize the graph structure
  variables.forEach((variable) => {
    graph[variable.name] = {
      parentVariables: [],
      childVariables: [],
      scope: variable.scope || "global", // Default to global scope if not specified
    };
  });

  // Second pass: build the dependency relationships
  variables.forEach((variable) => {
    const name = variable.name;

    // Handle query_values type specifically
    if (variable.type === "query_values") {
      // Process filters if they exist
      (variable.query_data?.filter || []).forEach((filter: any) => {
        const dependencies = extractVariableNames(
          filter.value,
          variableNameSet,
        );

        // Add parent dependencies to current variable
        graph[name].parentVariables.push(...dependencies);

        // Add current variable as child to all dependencies
        dependencies.forEach((dep) => {
          if (graph[dep]) {
            graph[dep].childVariables.push(name);
          }
        });
      });
    } else {
      // For other types, check if there are filters to process
      if (variable.query_data?.filter) {
        variable.query_data.filter.forEach((filter: any) => {
          if (
            typeof filter.value === "string" &&
            filter.value.startsWith("$")
          ) {
            const parentName = filter.value.substring(1);
            if (graph[parentName]) {
              graph[name].parentVariables.push(parentName);
              graph[parentName].childVariables.push(name);
            }
          }
        });
      }
    }
  });

  return graph;
};

/**
 * Recursive function to detect cycle in a graph
 *
 * @param {string} node current node
 * @param {Object} visited object to keep track of visited nodes
 * @param {Object} recStack object to keep track of nodes in recursion stack
 * @param {Object} graph graph data structure
 * @param {Array} path path to be returned in case of cycle
 * @returns {boolean} true if cycle is detected and false otherwise
 */
export const isGraphHasCycleUtil = (
  node: string,
  visited: any,
  recStack: any,
  graph: any,
  path: any
) => {
  // If node is not visited then recur for all the vertices
  // adjacent to this vertex
  if (!visited[node]) {
    // Mark the current node as visited and part of recursion stack
    visited[node] = true;
    recStack[node] = true;
    path.push(node);

    // Recur for all the vertices adjacent to this vertex
    // recursion call to all it's child node
    for (let i = 0; i < graph[node].parentVariables.length; i++) {
      const child = graph[node].parentVariables[i];

      // if child is not visited and not part of recursion stack
      // if child is already visited and part of recursion stack. so it means there is a cycle in the graph
      if (
        !visited[child] &&
        isGraphHasCycleUtil(child, visited, recStack, graph, path)
      ) {
        return true;
      } else if (recStack[child]) {
        return true;
      }
    }
  }

  // Remove the vertex from recursion stack and path
  recStack[node] = false;
  path.pop();
  return false;
};

/**
 * Detect cycle in a graph
 *
 * @param {Object} graph graph data structure
 * @returns {Array} path array storing the path of the cycle if any
 * or null if no cycle is found
 */
export const isGraphHasCycle = (graph: any) => {
  // Initialize a dictionary to mark all the vertices as not visited and not part of recursion stack
  const visited: any = {};
  const recStack: any = {}; // dictionary to keep track of vertices in recursion stack
  const path: any = []; // array to store the path

  // Initialize all vertices as not visited and not part of recursion stack
  for (const node of Object.keys(graph)) {
    visited[node] = false;
    recStack[node] = false;
  }

  // Call the recursive helper function to detect cycle in different DFS trees
  for (const node of Object.keys(graph)) {
    // Start from all vertices one by one and check if a cycle is formed
    if (isGraphHasCycleUtil(node, visited, recStack, graph, path)) {
      // Cycle found
      // so, return path
      return path;
    }
  }
  // no cycle found
  return null;
};
