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
            components::{Edge, FunctionParams, Node, NodeData, PipelineSource},
            Pipeline,
        },
        stream::StreamParams,
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
        let pos_offset: f32 = 100.0;
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

        match infra_pipeline::put(&pipeline).await {
            Err(e) => {
                log::error!(
                    "[Migration]: Error migrating Function x Stream association to the new pipeline format introduced in v0.12.2. Original data kept. Error: {}",
                    e
                );
            }
            Ok(()) => {
                // TODO(taiming): remove `streams` from Trans after done with testing
            }
        }
    }

    Ok(())
}

async fn migrate_pipelines() -> Result<(), anyhow::Error> {
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
        let pos_offset: f32 = 100.0;
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

        match infra_pipeline::put(&pipeline).await {
            Err(e) => {
                log::error!(
                    "[Migration]: Error migrating Function x Stream association to the new pipeline format introduced in v0.12.2. Original data kept. Error: {}",
                    e
                );
            }
            Ok(()) => {
                // TODO(taiming): remove `streams` from Trans after done with testing
            }
        }
    }

    Ok(())
}
