# Dashboard Variables System

## Overview

The dashboard variables system provides a flexible way to handle dynamic values in queries across dashboards. It supports:

- Multiple variable scopes (global, tab-level, panel-level)
- Variable dependencies and ordered loading
- URL parameter synchronization
- Dynamic filters
- Lazy loading based on visibility

## Variable Types

- `custom`: User-defined static values
- `query_values`: Dynamic values loaded from queries
- `constant`: Fixed values
- `dynamic_filters`: Ad-hoc filters that modify WHERE clauses
- `textbox`: Free-form text input

## Variable Dependencies

Variables can depend on other variables through their query filters. For example:

```sql
-- Environment variable depends on Service
SELECT DISTINCT environment
FROM logs
WHERE service = ${service}

-- Instance variable depends on both Service and Environment
SELECT DISTINCT instance
FROM logs
WHERE service = ${service}
  AND environment = ${environment}
```

The system automatically:

1. Builds a dependency graph
2. Determines the correct loading order
3. Handles cascading updates when parent values change

## Variable Scopes

Variables can be defined at different scopes:

- **Global**: Always visible and available everywhere
- **Tab**: Only visible/active in specific dashboard tabs
- **Panel**: Only visible/active in specific panels

The system manages visibility and loading states based on the current tab and visible panels.

## URL Parameters

Variable values are synchronized with URL parameters:

- Values are stored as `var-{name}` query parameters
- Arrays are stored as comma-separated values
- URL parameters take precedence over defaults

Example:

```
/dashboard?var-service=frontend&var-environment=prod,staging
```

## Dynamic Filters

Dynamic filters provide an ad-hoc way to filter data without predefined variables. They:

- Automatically modify query WHERE clauses
- Support multiple operators (=, >, <, etc.)
- Can be combined with regular variables

## Usage Example

```typescript
// Initialize variables manager
const {
  initializeVariablesData,
  updateVisibility,
  loadSingleVariableDataByName,
} = useVariablesManager({
  orgIdentifier: "my-org",
  selectedTimeDate: timeRange,
});

// Configure variables
initializeVariablesData({
  list: [
    {
      name: "service",
      type: "custom",
      scope: "global",
      options: ["frontend", "backend"],
    },
    {
      name: "environment",
      type: "query_values",
      scope: "tabs",
      tabId: "tab1",
      query_data: {
        stream: "logs",
        field: "env",
        filter: [{ name: "service", value: "${service}" }],
      },
    },
  ],
});

// Update visibility when tab/panels change
updateVisibility("tab1", ["panel1", "panel2"]);

// Load variables (automatically handles dependencies)
await loadSingleVariableDataByName("environment");
```

## Error Handling

The system provides comprehensive error handling:

- Validation during initialization
- API error handling with user-friendly messages
- Loading state tracking
- Dependency cycle detection

## Best Practices

1. Use appropriate variable scopes to minimize unnecessary loading
2. Consider dependencies when designing variable relationships
3. Provide default values when possible
4. Use dynamic filters for ad-hoc filtering needs
5. Keep the dependency chain shallow for better performance
