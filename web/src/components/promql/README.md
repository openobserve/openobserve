# PromQL Query Builder

A visual query builder for PromQL queries in OpenObserve.

## 🎯 Overview

The PromQL Query Builder provides a user-friendly interface to construct PromQL queries without writing them manually. It supports metric selection, label filtering, and operation chaining with drag-and-drop reordering.

## 📁 Project Structure

```
components/promql/
├── types/
│   └── index.ts              # TypeScript type definitions
├── operations/
│   ├── index.ts              # Operations registry (40+ operations)
│   └── queryModeller.ts      # Query rendering logic
├── components/
│   ├── MetricSelector.vue    # Metric picker with search
│   ├── LabelFilterEditor.vue # Label filters with operators
│   └── OperationsList.vue    # Operations with drag-and-drop
└── README.md                 # This file

views/PromQL/
└── QueryBuilder.vue          # Main view component
```

## 🚀 Accessing the Query Builder

The query builder is available at:
```
/promql-builder
```

Or via the router name:
```typescript
router.push({ name: 'promqlBuilder' })
```

## 🛠️ Features Implemented

### ✅ Phase 1: Core Architecture
- Type definitions for visual query structure
- Operations registry with 40+ PromQL operations
- Query renderer (visual query → PromQL string)
- Organized operations by category

### ✅ Phase 2: Metric & Label Selection
- Metric selector with search/autocomplete
- Label filter editor with 4 operators (=, !=, =~, !~)
- Dynamic label addition/removal
- Integration with metrics service

### ✅ Phase 3: Operations Management
- Drag-and-drop operation reordering
- Cascading operation selector by category
- Operation-specific parameter editors
- Real-time query generation

### ✅ Phase 4: UI/UX
- Clean, modern interface using Quasar components
- Real-time query preview
- Copy to clipboard functionality
- Clear query button
- Documentation hints for operations

## 📊 Supported Operations

### Range Functions (14 operations)
- `rate()`, `irate()`, `increase()`, `delta()`, `idelta()`
- `avg_over_time()`, `min_over_time()`, `max_over_time()`, `sum_over_time()`
- `count_over_time()`, `stddev_over_time()`, `quantile_over_time()`
- `last_over_time()`

### Aggregations (9 operations)
- `sum()`, `avg()`, `max()`, `min()`, `count()`
- `stddev()`, `topk()`, `bottomk()`, `quantile()`
- All support "by labels" grouping

### Functions (13 operations)
- `histogram_quantile()` - quantile from histogram buckets
- Math: `abs()`, `ceil()`, `floor()`, `round()`, `sqrt()`
- Logarithmic: `exp()`, `ln()`, `log2()`, `log10()`
- Sorting: `sort()`, `sort_desc()`
- Clamping: `clamp()`, `clamp_max()`, `clamp_min()`

### Time Functions (7 operations)
- `hour()`, `minute()`, `month()`, `year()`
- `day_of_month()`, `day_of_week()`, `days_in_month()`

## 💡 Usage Example

### Visual Query:
1. **Select Metric:** `http_requests_total`
2. **Add Label Filters:**
   - `method = "GET"`
   - `status =~ "2.."`
3. **Add Operations:**
   - `rate([5m])`
   - `sum(by: job, instance)`

### Generated PromQL:
```promql
sum(rate(http_requests_total{method="GET",status=~"2.."}[5m])) by (job, instance)
```

## 🔧 Component API

### MetricSelector
```vue
<MetricSelector
  v-model:metric="query.metric"
  :datasource="datasourceOptions"
  @update:metric="handleMetricChange"
/>
```

### LabelFilterEditor
```vue
<LabelFilterEditor
  v-model:labels="query.labels"
  :metric="query.metric"
  @update:labels="handleLabelsChange"
/>
```

### OperationsList
```vue
<OperationsList
  v-model:operations="query.operations"
  @update:operations="handleOperationsChange"
/>
```

## 🎨 Styling

All components use Quasar's design system and follow the existing OpenObserve styling conventions. The query builder uses a light gray background (`#f5f5f5`) to separate different sections visually.

## 🚧 Future Enhancements

### Short Term (Recommended)
1. **Query Execution** - Connect to actual Prometheus/Metrics API
2. **Results Visualization** - Display query results in charts
3. **Query History** - Save and load previous queries
4. **Templates** - Pre-built query templates for common use cases

### Medium Term
1. **Binary Operations** - Support for arithmetic between queries
2. **Subqueries** - Nested query support
3. **Advanced Functions** - Add remaining PromQL functions
4. **Smart Suggestions** - Context-aware label/metric suggestions

### Long Term
1. **Query Parser** - Parse existing PromQL to visual query (bidirectional)
2. **Query Optimizer** - Suggest query optimizations
3. **Integration** - Integrate into Dashboards/Metrics pages
4. **Export/Import** - Save queries as JSON

## 🔗 Integration Guide

To integrate the query builder components into the metrics explorer or dashboard:

```vue
<template>
  <div>
    <!-- Embed the query builder components -->
    <MetricSelector v-model:metric="visualQuery.metric" />
    <LabelFilterEditor v-model:labels="visualQuery.labels" />
    <OperationsList v-model:operations="visualQuery.operations" />

    <!-- Use the generated query -->
    <div>{{ generatedQuery }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { PromVisualQuery } from '@/components/promql/types';
import { promQueryModeller } from '@/components/promql/operations/queryModeller';
import MetricSelector from '@/components/promql/components/MetricSelector.vue';
import LabelFilterEditor from '@/components/promql/components/LabelFilterEditor.vue';
import OperationsList from '@/components/promql/components/OperationsList.vue';

const visualQuery = ref<PromVisualQuery>({
  metric: '',
  labels: [],
  operations: []
});

const generatedQuery = computed(() => {
  return promQueryModeller.renderQuery(visualQuery.value);
});
</script>
```

## 📝 Notes

- The query builder uses `vue-draggable-next` (already installed)
- All components are TypeScript-first
- Operations can be extended by adding to `operations/index.ts`
- Query rendering logic is in `operations/queryModeller.ts`

## 🐛 Known Limitations

1. Binary operations between queries not yet implemented
2. Query parsing (PromQL string → visual query) not implemented
3. Query execution is mocked (needs API integration)
4. Label value suggestions need metrics API integration

## 🤝 Contributing

To add a new operation:

1. Add the operation ID to `PromOperationId` enum in `types/index.ts`
2. Add the operation definition to `getOperationDefinitions()` in `operations/index.ts`
3. If needed, add custom rendering logic in `queryModeller.ts`

Example:
```typescript
{
  id: PromOperationId.MyNewOp,
  name: "My New Operation",
  params: [
    {
      name: "Parameter Name",
      type: "number",
      placeholder: "10"
    }
  ],
  defaultParams: [10],
  category: PromVisualQueryOperationCategory.Functions,
  documentation: "What this operation does"
}
```

## 📚 References

- [PromQL Documentation](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Grafana Query Builder](https://github.com/grafana/grafana/tree/main/packages/grafana-prometheus/src/querybuilder) - Reference implementation
- OpenObserve query-builder.md - Original requirements
