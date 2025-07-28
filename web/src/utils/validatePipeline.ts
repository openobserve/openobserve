interface QueryCondition {
  type?: 'sql' | 'promql';
  conditions?: any;
  sql?: string | null;
  promql?: string | null;
  promql_condition?: any | null;
  aggregation?: any | null;
  vrl_function?: any | null;
  search_event_type?: string;
}

interface TriggerCondition {
  period?: number;
  operator?: string;
  threshold?: number;
  frequency?: number;
  cron?: string;
  frequency_type?: 'minutes' | 'cron';
  silence?: number;
  timezone?: string;
}

interface Node {
  id: string;
  data: {
    node_type: string;
    org_id?: string;
    stream_name?: string | { label: string; value: string };
    destination_name?: string;
    name?: string;
    after_flatten?: boolean;
    stream_type?: string;
    query_condition?: QueryCondition;
    trigger_condition?: TriggerCondition;
  };
  io_type?: string;
}

interface Edge {
  id: string;
  source: string;
  target: string;
}

interface Pipeline {
  source: {
    org_id: string;
    source_type: string;
    stream_name: string;
  };
  nodes: Node[];
  edges: Edge[];
}

interface ValidationContext {
  streamList: string[];
  usedStreamsList: string[];
  originalPipeline: any;
  pipelineDestinations?: string[]; // Added for remote_stream validation
  functionsList?: string[]; // Added for function name validation
  selectedOrgId?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePipeline(pipeline: Pipeline, context?: ValidationContext): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: []
  };

  const validStreamTypes = ['logs', 'metrics', 'traces'];

  // Get the org_id from the source to match against nodes
  const sourceOrgId = pipeline.source.org_id || context?.selectedOrgId;

  // Validate nodes first
  pipeline.nodes.forEach(node => {
    // Validate io_type
    if (!node.io_type) {
      result.errors.push(`Node ${node.id} is missing required 'io_type' field`);
    } else {
      const validIoTypes = ['input', 'output', 'default'];
      if (!validIoTypes.includes(node.io_type)) {
        result.errors.push(`Node ${node.id} has invalid io_type '${node.io_type}'. Must be one of: ${validIoTypes.join(', ')}`);
      }
    }

    // Validate node_type
    if (!node.data.node_type) {
      result.errors.push(`Node ${node.id} is missing required 'node_type' field`);
    } else {
      const validNodeTypes = ['stream', 'query', 'function', 'condition', 'remote_stream'];
      if (!validNodeTypes.includes(node.data.node_type)) {
        result.errors.push(`Node ${node.id} has invalid node_type '${node.data.node_type}'. Must be one of: ${validNodeTypes.join(', ')}`);
      }
    }

    // Validate stream_type if present
    if (node.data.stream_type && !validStreamTypes.includes(node.data.stream_type)) {
      result.errors.push(`Node ${node.id} has invalid stream_type '${node.data.stream_type}'. Must be one of: ${validStreamTypes.join(', ')}`);
    }

    // Validate org_id matches source only for stream and remote_stream nodes
    if (['stream', 'remote_stream'].includes(node.data.node_type)) {
      if (!node.data.org_id) {
        result.errors.push(`Node ${node.id} is missing required 'org_id' field`);
      } else if (sourceOrgId && node.data.org_id !== sourceOrgId) {
        result.errors.push(`Node ${node.id} has mismatched org_id. Expected '${sourceOrgId}', got '${node.data.org_id}'`);
      }

      // For input stream nodes, validate stream existence and usage
      if (node.io_type === 'input' && node.data.node_type === 'stream' && context) {
        let streamName = '';
        if (typeof node.data.stream_name === 'string') {
          streamName = node.data.stream_name;
        } else if (node.data.stream_name && typeof node.data.stream_name === 'object') {
          streamName = node.data.stream_name.value;
        }

        if (streamName) {          
          // Only show error if this is a new stream name (different from original)
          const originalNode = context.originalPipeline?.nodes?.find((n: any) => n.id === node.id);
          const originalStreamName = typeof originalNode?.data?.stream_name === 'string' 
            ? originalNode.data.stream_name 
            : originalNode?.data?.stream_name?.value;

          if (context.usedStreamsList.includes(streamName) && streamName !== originalStreamName) {
            result.errors.push(`Input stream "${streamName}" in node ${node.id} is already used by another realtime pipeline`);
          }
        }
      }
    }

    // Validate query nodes
    if (node.io_type === 'input' && node.data.node_type === 'query') {
      // Validate query_condition
      if (!node.data.query_condition) {
        result.errors.push(`Query node ${node.id} is missing query_condition`);
      } else {
        const queryCondition = node.data.query_condition;

        // Validate query type
        if (!queryCondition.type) {
          result.errors.push(`Query node ${node.id} has empty query type. Must be either 'sql' or 'promql'`);
        } else if (!['sql', 'promql'].includes(queryCondition.type)) {
          result.errors.push(`Query node ${node.id} has invalid query type '${queryCondition.type}'. Must be either 'sql' or 'promql'`);
        }
        
        // Validate SQL query if type is sql
        if (queryCondition.type === 'sql') {
          if (!queryCondition.sql || queryCondition.sql.trim() === '') {
            result.errors.push(`Query node ${node.id} has empty SQL query`);
          }
          // Ensure promql related fields are null when type is sql
          if (queryCondition.promql !== null || queryCondition.promql_condition !== null) {
            result.errors.push(`Query node ${node.id} has SQL type but contains PromQL related data`);
          }
        }
        
        // Validate PromQL query if type is promql
        if (queryCondition.type === 'promql') {
          if (!queryCondition.promql || queryCondition.promql.trim() === '') {
            result.errors.push(`Query node ${node.id} has empty PromQL query`);
          }
          // Ensure sql field is null when type is promql
          if (queryCondition.sql !== null) {
            result.errors.push(`Query node ${node.id} has PromQL type but contains SQL related data`);
          }
        }
      }

      // Validate trigger_condition
      if (!node.data.trigger_condition) {
        result.errors.push(`Query node ${node.id} is missing trigger_condition`);
      } else {
        const trigger = node.data.trigger_condition;

        // Validate frequency_type
        if (!trigger.frequency_type) {
          result.errors.push(`Query node ${node.id} has empty frequency_type. Must be either 'minutes' or 'cron'`);
        } else if (!['minutes', 'cron'].includes(trigger.frequency_type)) {
          result.errors.push(`Query node ${node.id} has invalid frequency_type '${trigger.frequency_type}'. Must be either 'minutes' or 'cron'`);
        }

        // Validate timezone
        if (!trigger.timezone || trigger.timezone.trim() === '') {
          result.errors.push(`Query node ${node.id} has empty timezone`);
        }

        // Validate silence and threshold
        if (trigger.silence < 0) {
          result.errors.push(`Query node ${node.id} has invalid silence value. Must be >= 0`);
        }
        if (trigger.threshold < 0) {
          result.errors.push(`Query node ${node.id} has invalid threshold value. Must be >= 0`);
        }

        // Validate based on frequency_type
        if (trigger.frequency_type === 'minutes') {
          if (!trigger.frequency || trigger.frequency < 1) {
            result.errors.push(`Query node ${node.id} has invalid frequency. Must be >= 1 for minutes frequency type`);
          }
          if (!trigger.period || trigger.period < 1) {
            result.errors.push(`Query node ${node.id} has invalid period. Must be >= 1 for minutes frequency type`);
          }
          if (trigger.frequency !== trigger.period) {
            result.errors.push(`Query node ${node.id} has mismatched frequency and period. They must be equal for minutes frequency type`);
          }
        } else if (trigger.frequency_type === 'cron') {
          if (!trigger.cron || trigger.cron.trim() === '') {
            result.errors.push(`Query node ${node.id} has empty cron expression`);
          }
        }
      }
    }

    // Validate function nodes
    if (node.io_type === 'default' && node.data.node_type === 'function') {
      // Validate after_flatten exists and is boolean
      if (typeof node.data.after_flatten !== 'boolean') {
        result.errors.push(`Function node ${node.id} must have 'after_flatten' field as boolean`);
      }

      // Validate function name
      if (!node.data.name || node.data.name.trim() === '') {
        result.errors.push(`Function node ${node.id} has empty function name`);
      } else if (context?.functionsList && !context.functionsList.includes(node.data.name)) {
        result.errors.push(`Function node ${node.id} has invalid function name "${node.data.name}". Must be one of the available functions.`);
      }
    }

    // Validate output nodes
    if (node.io_type === 'output') {
      if (node.data.node_type === 'stream') {
        // For regular stream output, just check if stream name is not empty
        let streamName = '';
        if (typeof node.data.stream_name === 'string') {
          streamName = node.data.stream_name;
        } else if (node.data.stream_name && typeof node.data.stream_name === 'object') {
          streamName = node.data.stream_name.value;
        }

        if (!streamName || streamName.trim() === '') {
          result.errors.push(`Output stream node ${node.id} has empty stream name`);
        }
      } 
      else if (node.data.node_type === 'remote_stream') {
        // For remote stream output, check destination name and validate against pipelineDestinations
        if (!node.data.destination_name || node.data.destination_name.trim() === '') {
          result.errors.push(`Remote stream node ${node.id} has empty destination name`);
        } 
        else if (context?.pipelineDestinations && !context.pipelineDestinations.includes(node.data.destination_name)) {
          result.errors.push(`Remote stream node ${node.id} has invalid destination "${node.data.destination_name}". Must be one of the available pipeline destinations.`);
        }
      }
    }
  });

  // Basic edge validation
  const nodeIds = new Set(pipeline.nodes.map(node => node.id));
  pipeline.edges.forEach(edge => {
    if (!nodeIds.has(edge.source)) {
      result.errors.push(`Edge ${edge.id} references non-existent source node ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      result.errors.push(`Edge ${edge.id} references non-existent target node ${edge.target}`);
    }
  });

  // Validate edge connections
  const incomingEdges = new Map<string, number>();
  const outgoingEdges = new Map<string, number>();

  pipeline.nodes.forEach(node => {
    incomingEdges.set(node.id, 0);
    outgoingEdges.set(node.id, 0);
  });

  pipeline.edges.forEach(edge => {
    outgoingEdges.set(edge.source, (outgoingEdges.get(edge.source) || 0) + 1);
    incomingEdges.set(edge.target, (incomingEdges.get(edge.target) || 0) + 1);
  });

  pipeline.nodes.forEach(node => {
    const nodeId = node.id;
    const incomingCount = incomingEdges.get(nodeId) || 0;
    const outgoingCount = outgoingEdges.get(nodeId) || 0;

    if (node.io_type === 'input') {
      if (incomingCount > 0) {
        result.errors.push(`Input node ${nodeId} should not have incoming edges. Found ${incomingCount} incoming edges.`);
      }
    }
    else if (node.io_type === 'output') {
      if (incomingCount !== 1) {
        result.errors.push(`Output node ${nodeId} should have exactly one incoming edge. Found ${incomingCount} incoming edges.`);
      }
    }
    else if (node.data.node_type === 'function' || node.data.node_type === 'condition') {
      if (incomingCount === 0) {
        result.errors.push(`Function/Condition node ${nodeId} should have at least one incoming edge.`);
      }
      if (outgoingCount === 0) {
        result.errors.push(`Function/Condition node ${nodeId} should have at least one outgoing edge.`);
      }
    }
  });

  result.isValid = result.errors.length === 0;
  return result;
} 