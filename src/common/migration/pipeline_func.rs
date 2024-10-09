// Copyright 2024 Zinc Labs Inc.
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

use std::collections::HashMap;

use config::{
    ider,
    meta::{
        function,
        pipeline::{
            components::{
                ConditionParams, DerivedStream, Edge, FunctionParams, Node, NodeData,
                PipelineSource,
            },
            Pipeline,
        },
        stream::{StreamParams, StreamType},
    },
    utils::json,
};
use infra::{db as infra_db, pipeline as infra_pipeline};

pub async fn run() -> Result<(), anyhow::Error> {
    migrate_stream_association().await?;
    migrate_pipelines().await?;
    Ok(())
}

async fn migrate_stream_association() -> Result<(), anyhow::Error> {
    let mut stream_funcs: HashMap<StreamParams, Vec<(u8, FunctionParams)>> = HashMap::new();

    // load all functions from meta table
    let db = infra_db::get_db().await;
    let db_key = "/function/";
    let data = db.list(db_key).await?;
    for (key, val) in data {
        let local_key = key.strip_prefix('/').unwrap_or(&key);
        let key_col = local_key.split('/').collect::<Vec<&str>>();
        let trans: function::Transform = json::from_slice(&val).unwrap();
        if let Some(stream_orders) = trans.streams.clone() {
            for stream_ord in stream_orders {
                let func_params = FunctionParams {
                    name: trans.name.clone(),
                    num_args: trans.num_args,
                    after_flatten: !stream_ord.apply_before_flattening,
                };
                let entry = stream_funcs
                    .entry(StreamParams::new(
                        key_col[1],
                        &stream_ord.stream,
                        stream_ord.stream_type,
                    ))
                    .or_default();
                entry.push((stream_ord.order, func_params));
            }
        }
    }

    for (stream_params, mut func_params) in stream_funcs {
        func_params.sort_by(|a, b| a.0.cmp(&b.0));

        let pipeline_source = PipelineSource::Realtime(stream_params.clone());

        // construct the nodes and edges lists
        let source_node_data = NodeData::Stream(stream_params.clone());
        let dest_node_data = NodeData::Stream(stream_params.clone());
        let (pos_x, pos_y): (f32, f32) = (50.0, 50.0);
        let pos_offset: f32 = 200.0;
        let source_node = Node::new(
            ider::uuid(),
            source_node_data,
            pos_x,
            pos_y,
            "input".to_string(),
        );

        let dest_node = Node::new(
            ider::uuid(),
            dest_node_data,
            pos_x + (pos_offset * (func_params.len() + 1) as f32),
            pos_y + (pos_offset * (func_params.len() + 1) as f32),
            "output".to_string(),
        );

        let mut nodes: Vec<Node> = vec![source_node];
        for (idx, (_, func_param)) in func_params.into_iter().enumerate() {
            let func_node_data = NodeData::Function(func_param);
            let func_node = Node::new(
                ider::uuid(),
                func_node_data,
                pos_x + (pos_offset * (idx + 1) as f32),
                pos_y + (pos_offset * (idx + 1) as f32),
                "default".to_string(),
            );
            nodes.push(func_node);
        }
        nodes.push(dest_node);

        let edges = nodes
            .windows(2)
            .map(|pair| Edge::new(pair[0].id.clone(), pair[1].id.clone()))
            .collect::<Vec<_>>();

        let pl_id = ider::uuid();
        let name = format!("Migrated-{pl_id}");
        let description = "This pipeline was generated based on Function x Stream Associations found prior to OpenObserve v0.12.2. Please check the correctness of the pipeline and enabling manually".to_string();
        let pipeline = Pipeline {
            id: pl_id,
            version: 0,
            enabled: false,
            org: stream_params.org_id.to_string(),
            name,
            description,
            source: pipeline_source,
            nodes,
            edges,
        };

        match crate::service::pipeline::save_pipeline(pipeline).await {
            Ok(res) if res.status().as_u16() == 200 => {
                // TODO(taiming): remove `streams` from Trans after done with testing
            }
            _ => {
                log::error!(
                    "[Migration]: Error migrating Function x Stream association to the new pipeline format introduced in v0.12.2. Original data kept.",
                );
            }
        }
    }

    Ok(())
}

async fn migrate_pipelines() -> Result<(), anyhow::Error> {
    let mut new_pipelines = vec![];

    // load all old pipelines from meta table
    let db = infra_db::get_db().await;
    let db_key = "/pipeline/";
    let data = db.list(db_key).await?;
    for (key, val) in data {
        let local_key = key.strip_prefix('/').unwrap_or(&key);
        let key_col = local_key.split('/').collect::<Vec<&str>>();
        let old_pipe: crate::common::meta::pipelines::PipeLine = json::from_slice(&val).unwrap();

        // two scenarios:
        // scenario 1: with DerivedStream info
        if let Some(old_derived_streams) = old_pipe.derived_streams {
            for old_derived_stream in old_derived_streams {
                let new_derived_stream = DerivedStream {
                    org_id: old_derived_stream.source.org_id.to_string(),
                    stream_type: old_derived_stream.source.stream_type,
                    query_condition: old_derived_stream.query_condition,
                    trigger_condition: old_derived_stream.trigger_condition,
                    tz_offset: old_derived_stream.tz_offset,
                };

                let pipeline_source = PipelineSource::Scheduled(new_derived_stream.clone());

                // construct the nodes and edges lists
                let source_node_data = NodeData::Query(new_derived_stream);
                let dest_node_data = NodeData::Stream(old_derived_stream.destination);
                let (pos_x, pos_y): (f32, f32) = (50.0, 50.0);
                let pos_offset: f32 = 200.0;
                let source_node = Node::new(
                    ider::uuid(),
                    source_node_data,
                    pos_x,
                    pos_y,
                    "input".to_string(),
                );

                let dest_node = Node::new(
                    ider::uuid(),
                    dest_node_data,
                    pos_x + pos_offset,
                    pos_y + pos_offset,
                    "output".to_string(),
                );

                let nodes: Vec<Node> = vec![source_node, dest_node];
                let edges = nodes
                    .windows(2)
                    .map(|pair| Edge::new(pair[0].id.clone(), pair[1].id.clone()))
                    .collect::<Vec<_>>();
                let pl_id = ider::uuid();
                let name = format!("Migrated-{pl_id}");
                let description = "This pipeline was generated from previous found prior to OpenObserve v0.12.2. Please check and confirm before enabling it manually".to_string();
                let pipeline = Pipeline {
                    id: pl_id,
                    version: 0,
                    enabled: false,
                    org: old_derived_stream.source.org_id.to_string(),
                    name,
                    description,
                    source: pipeline_source,
                    nodes,
                    edges,
                };
                new_pipelines.push(pipeline);
            }
        }

        // scenario 2: no DerivedStream info
        // build a new realtime pipeline: only when there's routing conditions
        if let Some(routings) = old_pipe.routing {
            let source_params =
                StreamParams::new(key_col[1], key_col[3], StreamType::from(key_col[2]));

            let pipeline_source = PipelineSource::Realtime(source_params.clone());

            // construct the nodes and edges lists
            let source_node_data = NodeData::Stream(source_params);
            let (mut pos_x, mut pos_y): (f32, f32) = (50.0, 50.0);
            let pos_offset: f32 = 200.0;
            let source_node = Node::new(
                ider::uuid(),
                source_node_data,
                pos_x,
                pos_y,
                "input".to_string(),
            );

            let source_node_id = source_node.id.clone();
            let mut nodes = vec![source_node];
            let mut edges = vec![];

            for (dest_stream, routing_conditions) in routings {
                pos_x += pos_offset;
                let condition_node = Node::new(
                    ider::uuid(),
                    NodeData::Condition(ConditionParams {
                        conditions: routing_conditions,
                    }),
                    pos_x,
                    pos_y,
                    "default".to_string(),
                );
                pos_x += pos_offset;
                let dest_node = Node::new(
                    ider::uuid(),
                    NodeData::Stream(StreamParams::new(
                        key_col[1],
                        &dest_stream,
                        StreamType::from(key_col[2]),
                    )),
                    pos_x,
                    pos_y,
                    "output".to_string(),
                );
                edges.push(Edge::new(source_node_id.clone(), condition_node.id.clone()));
                edges.push(Edge::new(condition_node.id.clone(), dest_node.id.clone()));
                nodes.push(condition_node);
                nodes.push(dest_node);
                pos_y += pos_offset;
            }

            let pl_id = ider::uuid();
            let name = format!("Migrated-{pl_id}");
            let description = "This pipeline was generated from previous found prior to OpenObserve v0.12.2. Please check and confirm before enabling it manually".to_string();
            let pipeline = Pipeline {
                id: pl_id,
                version: 0,
                enabled: false,
                org: key_col[1].to_string(),
                name,
                description,
                source: pipeline_source,
                nodes,
                edges,
            };
            new_pipelines.push(pipeline);
        }
    }

    for pipeline in new_pipelines {
        match crate::service::pipeline::save_pipeline(pipeline).await {
            Ok(res) if res.status().as_u16() == 200 => {
                // TODO(taiming): remove `streams` from Trans after done with testing
            }
            _ => {
                log::error!(
                    "[Migration]: Error migrating Function x Stream association to the new pipeline format introduced in v0.12.2. Original data kept."
                );
            }
        }
    }

    Ok(())
}
