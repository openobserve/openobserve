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
