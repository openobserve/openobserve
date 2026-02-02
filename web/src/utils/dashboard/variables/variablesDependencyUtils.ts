/**
 * Extract variable names from a string
 * @param {string} str - string to search for variable names
 * @param {Set<string>} variableNames - set of variable names to search for (optional)
 * @returns {string[]} - array of variable names found in the string
 */
export const extractVariableNames = (
  str: string,
  variableNames?: Set<string>
): string[] => {
  const regex = /\$([a-zA-Z0-9_-]+)/g; // find all occurrences of $<variable_name>
  const names: string[] = [];
  let match: RegExpExecArray | null;
  // loop over all matches
  while ((match = regex.exec(str)) !== null) {
    // match[0]: This will log: $a-k8s_namespace_name
    // match[1]: This will log: a-k8s_namespace_name
    // only include the variable name if it exists in the list of variables
    if (!variableNames || variableNames.has(match[1])) {
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

// ========== SCOPED DEPENDENCY GRAPH FUNCTIONS ==========

export interface ScopedDependencyGraph {
  [variableKey: string]: {
    parents: string[];
    children: string[];
    scope: "global" | "tabs" | "panels";
    tabId?: string;
    panelId?: string;
  };
}

interface VariableRuntimeState {
  name: string;
  scope: "global" | "tabs" | "panels";
  tabId?: string;
  panelId?: string;
  type: string;
  query_data?: {
    filter?: Array<{
      filter?: string;
      value?: string;
    }>;
  };
}

// Helper to generate variable keys
const getVariableKey = (
  name: string,
  scope: "global" | "tabs" | "panels",
  tabId?: string,
  panelId?: string
): string => {
  if (scope === "global") {
    return `${name}@global`;
  } else if (scope === "tabs") {
    return `${name}@tab@${tabId}`;
  } else {
    return `${name}@panel@${panelId}`;
  }
};

/**
 * Check if a dependency is valid based on scope hierarchy
 * @param parent - parent variable node
 * @param child - child variable node
 * @returns true if dependency is valid, false otherwise
 */
const isValidDependency = (
  parent: { scope: string; tabId?: string; panelId?: string },
  child: { scope: string; tabId?: string; panelId?: string }
): boolean => {
  // Global can be parent of anything
  if (parent.scope === "global") return true;

  // Tab can be parent of panel or same tab
  if (parent.scope === "tabs") {
    if (child.scope === "panels") return true;
    if (child.scope === "tabs" && parent.tabId === child.tabId) return true;
    return false;
  }

  // Panel can be parent of same panel only
  if (parent.scope === "panels") {
    return child.scope === "panels" && parent.panelId === child.panelId;
  }

  return false;
};

/**
 * Resolve which parent variable a child should connect to based on scope hierarchy
 * @param parentName - name of parent variable to find
 * @param childScope - scope of the child variable
 * @param childTabId - tab ID if child is tab-scoped
 * @param childPanelId - panel ID if child is panel-scoped
 * @param allVariables - all expanded variables
 * @param panelTabMapping - mapping of panel IDs to tab IDs
 * @returns variable key of the parent, or null if not found
 */
const resolveParentVariable = (
  parentName: string,
  childScope: "global" | "tabs" | "panels",
  childTabId: string | undefined,
  childPanelId: string | undefined,
  allVariables: VariableRuntimeState[],
  panelTabMapping: Record<string, string>
): string | null => {
  // Resolution order (child looking for parent):
  // 1. If child is global: Look in global only
  // 2. If child is tab: Look in same tab, then global
  // 3. If child is panel: Look in same panel, then parent tab, then global

  if (childScope === "global") {
    const parent = allVariables.find(
      (v) => v.name === parentName && v.scope === "global"
    );
    return parent ? getVariableKey(parent.name, parent.scope) : null;
  }

  if (childScope === "tabs") {
    // Check same tab first
    let parent = allVariables.find(
      (v) =>
        v.name === parentName && v.scope === "tabs" && v.tabId === childTabId
    );
    if (parent) return getVariableKey(parent.name, parent.scope, parent.tabId);

    // Fall back to global
    parent = allVariables.find(
      (v) => v.name === parentName && v.scope === "global"
    );
    return parent ? getVariableKey(parent.name, parent.scope) : null;
  }

  if (childScope === "panels") {
    // Check same panel first
    let parent = allVariables.find(
      (v) =>
        v.name === parentName &&
        v.scope === "panels" &&
        v.panelId === childPanelId
    );
    if (parent)
      return getVariableKey(
        parent.name,
        parent.scope,
        undefined,
        parent.panelId
      );

    // Check parent tab (need to know which tab the panel belongs to)
    const panelTabId = panelTabMapping[childPanelId!];
    if (panelTabId) {
      parent = allVariables.find(
        (v) =>
          v.name === parentName && v.scope === "tabs" && v.tabId === panelTabId
      );
      if (parent)
        return getVariableKey(parent.name, parent.scope, parent.tabId);
    }

    // Fall back to global
    parent = allVariables.find(
      (v) => v.name === parentName && v.scope === "global"
    );
    return parent ? getVariableKey(parent.name, parent.scope) : null;
  }

  return null;
};

/**
 * Build scoped dependency graph for variables
 * @param variables - array of expanded variable runtime states
 * @param panelTabMapping - mapping of panel IDs to tab IDs
 * @returns scoped dependency graph
 */
export const buildScopedDependencyGraph = (
  variables: VariableRuntimeState[],
  panelTabMapping: Record<string, string>
): ScopedDependencyGraph => {
  const graph: ScopedDependencyGraph = {};

  // Step 1: Initialize nodes
  variables.forEach((variable) => {
    const key = getVariableKey(
      variable.name,
      variable.scope,
      variable.tabId,
      variable.panelId
    );
    graph[key] = {
      parents: [],
      children: [],
      scope: variable.scope,
      tabId: variable.tabId,
      panelId: variable.panelId,
    };
  });

  // Step 2: Build edges
  variables.forEach((variable) => {
    const childKey = getVariableKey(
      variable.name,
      variable.scope,
      variable.tabId,
      variable.panelId
    );

    if (variable.type === "query_values") {
      const filters = variable.query_data?.filter || [];

      filters.forEach((filter) => {
        // Extract parent variable names from filter (e.g., "$country")
        const filterString = filter.filter || filter.value || "";
        const parentNames = extractVariableNames(filterString);

        parentNames.forEach((parentName) => {
          // Resolve which parent variable this child should connect to
          const parentKey = resolveParentVariable(
            parentName,
            variable.scope,
            variable.tabId,
            variable.panelId,
            variables,
            panelTabMapping
          );

          if (parentKey) {
            // Validate dependency is allowed
            if (isValidDependency(graph[parentKey], graph[childKey])) {
              graph[childKey].parents.push(parentKey);
              graph[parentKey].children.push(childKey);
            } else {
              throw new Error(
                `Invalid dependency: ${childKey} cannot depend on ${parentKey}`
              );
            }
          }
        });
      });
    }
  });

  return graph;
};

/**
 * Detect cycles in scoped dependency graph
 * @param graph - scoped dependency graph
 * @returns array representing cycle path if found, null otherwise
 */
export const detectCyclesInScopedGraph = (
  graph: ScopedDependencyGraph
): string[] | null => {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const dfsDetectCycle = (
    nodeKey: string,
    path: string[]
  ): string[] | null => {
    if (!visited.has(nodeKey)) {
      visited.add(nodeKey);
      recStack.add(nodeKey);
      path.push(nodeKey);

      const parents = graph[nodeKey]?.parents || [];

      for (const parentKey of parents) {
        if (!visited.has(parentKey)) {
          const cyclePath = dfsDetectCycle(parentKey, [...path]);
          if (cyclePath) return cyclePath;
        } else if (recStack.has(parentKey)) {
          return [...path, parentKey];
        }
      }
    }

    recStack.delete(nodeKey);
    return null;
  };

  for (const nodeKey of Object.keys(graph)) {
    if (!visited.has(nodeKey)) {
      const cyclePath = dfsDetectCycle(nodeKey, []);
      if (cyclePath) {
        return cyclePath;
      }
    }
  }

  return null;
};
