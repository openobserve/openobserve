// Copyright 2026 OpenObserve Inc.

/** 3 pipelines x 12 function nodes that name functions which do not exist (ENT#1447). */
function pipelinesWithMissingFunctions(run) {
  const node = (id, data, io_type, y) => ({ id, data, position: { x: 100, y }, io_type });
  const edge = (source, target) => ({ id: `e${source}-${target}`, source, target, type: 'custom' });
  return [0, 1, 2].map((p) => {
    const src = `p${p}-src`;
    const out = `p${p}-out`;
    const fns = Array.from({ length: 12 }, (_, i) => `p${p}-fn${i}`);
    const chain = [src, ...fns, out];
    return {
      version: 3,
      enabled: false,
      org: 'default',
      name: `ovnb1447_${run}_${p}`,
      description: '',
      source: { source_type: 'realtime', org_id: 'default', stream_name: 'e2e_automate', stream_type: 'logs' },
      nodes: [
        node(src, { node_type: 'stream', org_id: 'default', stream_name: 'e2e_automate', stream_type: 'logs' }, 'input', 0),
        ...fns.map((id, i) => node(id, { node_type: 'function', name: `ovnb1447_missing_${run}_${p}_${i}`, after_flatten: false, num_args: 0 }, 'default', 60 * (i + 1))),
        node(out, { node_type: 'stream', org_id: 'default', stream_name: `ovnb1447_out_${run}`, stream_type: 'logs' }, 'output', 800),
      ],
      edges: chain.slice(1).map((target, i) => edge(chain[i], target)),
    };
  });
}

module.exports = { pipelinesWithMissingFunctions };
