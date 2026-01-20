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

export interface OperatorNode {
  name: string;
  fullText: string;
  depth: number;
  metrics: {
    elapsed_compute_ms?: number;
    output_rows?: number;
    memory_bytes?: number;
    [key: string]: any;
  };
  children: OperatorNode[];
  isRepartitionExec: boolean;
}

export interface SummaryMetrics {
  totalTime: string;
  totalRows: string;
  peakMemory: string;
}

/**
 * Parse time string to milliseconds
 */
function parseTime(timeStr: string): number {
  const match = timeStr.match(/(\d+(?:\.\d+)?)(ms|s|us|µs|ns)/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return value * 1000;
    case 'ms':
      return value;
    case 'us':
    case 'µs':
      return value / 1000;
    case 'ns':
      return value / 1000000;
    default:
      return 0;
  }
}

/**
 * Parse memory string to bytes
 */
function parseMemory(memStr: string): number {
  const match = memStr.match(/(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case 'TB':
      return value * 1024 * 1024 * 1024 * 1024;
    case 'GB':
      return value * 1024 * 1024 * 1024;
    case 'MB':
      return value * 1024 * 1024;
    case 'KB':
      return value * 1024;
    case 'B':
    default:
      return value;
  }
}

/**
 * Format time in milliseconds to human-readable string
 */
export function formatTime(ms: number): string {
  if (ms === 0) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

/**
 * Format bytes to human-readable string
 */
export function formatMemory(bytes: number): string {
  if (bytes === 0) return 'N/A';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/**
 * Extract metrics from an operator line
 */
function extractMetrics(line: string): { [key: string]: any } {
  const metrics: { [key: string]: any } = {};

  // Extract elapsed_compute
  const timeMatch = line.match(/elapsed_compute=([^,\s\]]+)/);
  if (timeMatch) {
    metrics.elapsed_compute = timeMatch[1];
    metrics.elapsed_compute_ms = parseTime(timeMatch[1]);
  }

  // Extract output_rows
  const rowsMatch = line.match(/output_rows=(\d+)/);
  if (rowsMatch) {
    metrics.output_rows = parseInt(rowsMatch[1]);
  }

  // Extract memory-related metrics
  const memoryMatch = line.match(/(?:memory|spill_count|mem_used)=([^,\s\]]+)/i);
  if (memoryMatch) {
    metrics.memory = memoryMatch[1];
    metrics.memory_bytes = parseMemory(memoryMatch[1]);
  }

  // Extract other metrics (key=value pairs)
  const metricRegex = /(\w+)=([^,\s\]]+)/g;
  let match;
  while ((match = metricRegex.exec(line)) !== null) {
    const [, key, value] = match;
    if (!metrics[key]) {
      metrics[key] = value;
    }
  }

  return metrics;
}

/**
 * Get indentation depth from line
 */
function getDepth(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/**
 * Parse query plan text into tree structure
 */
export function parseQueryPlanTree(planText: string): OperatorNode {
  const lines = planText.split('\n').filter(line => line.trim());
  const root: OperatorNode = {
    name: 'Root',
    fullText: '',
    depth: -1,
    metrics: {},
    children: [],
    isRepartitionExec: false,
  };

  const stack: OperatorNode[] = [root];

  for (const line of lines) {
    const depth = getDepth(line);
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    let name: string;

    if (trimmed.includes(':')) {
      // Has colon: extract name from before first colon
      const colonIndex = trimmed.indexOf(':');
      name = trimmed.substring(0, colonIndex).trim();
    } else {
      // No colon: check if it looks like an operator
      // Common patterns: CoalescePartitionsExec, RemoteExec, SortExec, ProjectionExec, etc.
      // Operators typically end with: Exec, Plan, Scan, Join, Relation, Source, Sink
      if (/(?:Exec|Plan|Scan|Join|Relation|Source|Sink)$/i.test(trimmed)) {
        name = trimmed;
      } else {
        // Doesn't look like an operator, skip it
        continue;
      }
    }

    const node: OperatorNode = {
      name,
      fullText: trimmed,
      depth,
      metrics: extractMetrics(trimmed),
      children: [],
      isRepartitionExec: /RepartitionExec/i.test(name),
    };

    // Pop stack until we find the parent (depth < current depth)
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    // Add as child to current parent
    const parent = stack[stack.length - 1];
    parent.children.push(node);

    // Push this node onto stack for potential children
    stack.push(node);
  }

  return root;
}

/**
 * Calculate metrics recursively considering RepartitionExec parallel execution
 */
function calculateNodeMetrics(node: OperatorNode): {
  maxTime: number;
  totalRows: number;
  maxMemory: number;
} {
  // Leaf node - return its own metrics
  if (node.children.length === 0) {
    return {
      maxTime: node.metrics.elapsed_compute_ms || 0,
      totalRows: node.metrics.output_rows || 0,
      maxMemory: node.metrics.memory_bytes || 0,
    };
  }

  // Recursive: aggregate children first
  const childMetrics = node.children.map(child => calculateNodeMetrics(child));

  // Check if this is a RepartitionExec (parallel execution coordinator)
  if (node.isRepartitionExec) {
    // Parallel execution: MAX time, SUM rows
    return {
      maxTime: Math.max(
        node.metrics.elapsed_compute_ms || 0,
        ...childMetrics.map(m => m.maxTime)
      ),
      totalRows: childMetrics.reduce((sum, m) => sum + m.totalRows, 0),
      maxMemory: Math.max(
        node.metrics.memory_bytes || 0,
        ...childMetrics.map(m => m.maxMemory)
      ),
    };
  } else {
    // Sequential execution: SUM time, pass through rows from first child or own
    const childTime = childMetrics.reduce((sum, m) => sum + m.maxTime, 0);
    return {
      maxTime: childTime + (node.metrics.elapsed_compute_ms || 0),
      totalRows: node.metrics.output_rows || childMetrics[0]?.totalRows || 0,
      maxMemory: Math.max(
        node.metrics.memory_bytes || 0,
        ...childMetrics.map(m => m.maxMemory)
      ),
    };
  }
}

/**
 * Calculate summary metrics from query plan text
 */
export function calculateSummaryMetrics(planText: string): SummaryMetrics {
  const tree = parseQueryPlanTree(planText);
  const metrics = calculateNodeMetrics(tree);

  return {
    totalTime: formatTime(metrics.maxTime),
    totalRows: metrics.totalRows.toLocaleString('en-US'),
    peakMemory: formatMemory(metrics.maxMemory),
  };
}

/**
 * Find RemoteExec or RemoteScanExec node in the operator tree
 * Used for nesting Phase 1 plans under Phase 0 Remote*Exec in EXPLAIN ANALYZE
 */
export function findRemoteExecNode(node: OperatorNode): OperatorNode | null {
  // Check if current node is RemoteExec, RemoteScanExec, or any Remote*Exec variant
  if (/Remote\w*Exec/i.test(node.name)) {
    return node;
  }

  // Recursively search children
  for (const child of node.children) {
    const found = findRemoteExecNode(child);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Collapse long projection lists in query plan
 * Example: "Projection: [field1, field2, field3, ... 97 more]"
 */
export function collapseProjections(planText: string, threshold: number = 5): string {
  const lines = planText.split('\n');
  const collapsedLines = lines.map(line => {
    // Match projection patterns like: Projection: [field1, field2, field3, ...]
    const projectionMatch = line.match(/(.*Projection.*:\s*\[)([^\]]+)(\].*)/i);

    if (!projectionMatch) return line;

    const [, prefix, fieldsList, suffix] = projectionMatch;

    // Split by comma, handling nested brackets and quotes
    const fields: string[] = [];
    let current = '';
    let depth = 0;
    let inQuotes = false;

    for (const char of fieldsList) {
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (!inQuotes && (char === '(' || char === '[' || char === '{')) {
        depth++;
      } else if (!inQuotes && (char === ')' || char === ']' || char === '}')) {
        depth--;
      } else if (!inQuotes && depth === 0 && char === ',') {
        fields.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) {
      fields.push(current.trim());
    }

    // If fields count exceeds threshold, collapse
    if (fields.length > threshold) {
      const visible = fields.slice(0, 3);
      const hiddenCount = fields.length - 3;
      const collapsed = `${visible.join(', ')}, ... ${hiddenCount} more`;
      return `${prefix}${collapsed}${suffix}`;
    }

    return line;
  });

  return collapsedLines.join('\n');
}
