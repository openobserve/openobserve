use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use bytes::Bytes;
use config::ider;
use pprof::protos::{Message, Profile};
use proto::profiling::{
    continuous_profiling_service_server::ContinuousProfilingService, ProfileData, ProfileResponse,
};
use serde::{Deserialize, Serialize};
use tonic::{Request, Response, Status};

use crate::{common::meta::ingestion::IngestionRequest, service::logs};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FlameGraphNode {
    id: String,
    name: String,
    value: u64,
    children: Vec<FlameGraphNode>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FlameGraphData {
    name: String,
    value: u64,
    children: Vec<FlameGraphNode>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfilingData {
    pub raw_pprof: Vec<u8>,
    pub metadata: ProfileMetadata,
    pub flame_data: FlameGraphData,
}

impl ProfilingData {
    fn to_json(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileMetadata {
    pub instance_name: String,
    // TODO: Add more fields as needed:
    // - timestamp
    // - environment
    // - service name
    // - version
    // etc.
}

#[derive(Default)]
pub struct ContinuousProfilingServer {}

impl FlameGraphData {
    fn from_profile(profile: &Profile) -> Result<Self, String> {
        let mut function_samples: HashMap<u64, u64> = HashMap::new();
        let mut function_children: HashMap<u64, HashSet<u64>> = HashMap::new();

        // Create location to function ID lookup
        let location_to_function: HashMap<u64, u64> = profile
            .location
            .iter()
            .filter_map(|loc| loc.line.first().map(|line| (loc.id, line.function_id)))
            .collect();

        // Process samples and maintain full call stacks
        for sample in &profile.sample {
            let stack: Vec<_> = sample
                .location_id
                .iter()
                .filter_map(|&loc_id| location_to_function.get(&loc_id))
                .copied()
                .collect();

            // Update sample counts
            for &func_id in &stack {
                *function_samples.entry(func_id).or_default() += sample.value[0] as u64;
            }

            // Build parent-child relationships
            for window in stack.windows(2) {
                let [caller_id, callee_id] = window else {
                    continue;
                };
                function_children
                    .entry(*caller_id)
                    .or_default()
                    .insert(*callee_id);
            }
        }

        // Find root functions
        let called_functions: HashSet<_> = function_children
            .values()
            .flat_map(|children| children.iter())
            .copied()
            .collect();

        let root_functions: Vec<_> = profile
            .function
            .iter()
            .filter(|f| !called_functions.contains(&f.id))
            .map(|f| f.id)
            .collect();

        // Build tree
        let total_value = profile.sample.iter().map(|s| s.value[0] as u64).sum();
        let children = root_functions
            .iter()
            .filter_map(|&id| {
                let func = profile.function.iter().find(|f| f.id == id)?;
                let name = profile
                    .string_table
                    .get(func.name as usize)
                    .unwrap_or(&"unknown".to_string())
                    .to_string();
                let value = *function_samples.get(&id).unwrap_or(&0);

                Some(FlameGraphNode {
                    id: id.to_string(),
                    name,
                    value,
                    children: build_children(id, profile, &function_samples, &function_children),
                })
            })
            .collect();

        Ok(FlameGraphData {
            name: "root".to_string(),
            value: total_value,
            children,
        })
    }
}

fn build_children(
    func_id: u64,
    profile: &Profile,
    function_samples: &HashMap<u64, u64>,
    function_children: &HashMap<u64, HashSet<u64>>,
) -> Vec<FlameGraphNode> {
    let mut result = Vec::new();
    let mut stack = vec![(func_id, 0)];
    let mut visited = HashSet::new();

    while let Some((current_id, depth)) = stack.pop() {
        if depth > 3 || !visited.insert(current_id) {
            continue;
        }

        if let Some(children) = function_children.get(&current_id) {
            for &child_id in children {
                if let Some(func) = profile.function.iter().find(|f| f.id == child_id) {
                    let name = profile
                        .string_table
                        .get(func.name as usize)
                        .unwrap_or(&"unknown".to_string())
                        .to_string();
                    let value = *function_samples.get(&child_id).unwrap_or(&0);

                    let node = FlameGraphNode {
                        id: child_id.to_string(),
                        name,
                        value,
                        children: Vec::new(),
                    };

                    result.push(node);
                    stack.push((child_id, depth + 1));
                }
            }
        }
    }

    result
}

const PROFILING_STREAM: &str = "_profiling"; // Stream name for profiling data

#[tonic::async_trait]
impl ContinuousProfilingService for ContinuousProfilingServer {
    async fn handle_profile(
        &self,
        request: Request<ProfileData>,
    ) -> Result<Response<ProfileResponse>, Status> {
        log::info!("Received profile request");
        let _start_time = Instant::now();
        let ProfileData {
            raw_pprof,
            metadata,
        } = request.into_inner();

        // Parse metadata
        let _metadata: ProfileMetadata = serde_json::from_str(&metadata)
            .map_err(|e| Status::invalid_argument(format!("Invalid metadata: {}", e)))?;

        // Process profile in a blocking task
        let process_result = tokio::time::timeout(
            Duration::from_secs(30),
            tokio::task::spawn_blocking(move || {
                Profile::decode(&raw_pprof[..]).map(|profile| {
                    let flame_data = FlameGraphData::from_profile(&profile)
                        .map_err(|e| prost::DecodeError::new(e))?;
                    Ok::<(Vec<u8>, FlameGraphData), prost::DecodeError>((raw_pprof, flame_data))
                })
            }),
        )
        .await;

        match process_result {
            Ok(Ok(Ok(Ok((raw_pprof, flame_data))))) => {
                let profile_id = ider::uuid();
                let profiling_data = ProfilingData {
                    raw_pprof,
                    metadata: _metadata,
                    flame_data,
                };

                match logs::ingest::ingest(
                    0,
                    "default",
                    PROFILING_STREAM,
                    IngestionRequest::JSON(&Bytes::from(profiling_data.to_json().unwrap())),
                    "root@example.com",
                    None,
                )
                .await
                {
                    Ok(_) => Ok(Response::new(ProfileResponse { profile_id })),
                    Err(e) => {
                        log::error!("Failed to ingest profile: {}", e);
                        Err(Status::internal("Failed to ingest profile"))
                    }
                }
            }
            Ok(Ok(Ok(Err(e)))) => {
                log::error!("Failed to process profile: {}", e);
                Err(Status::internal("Failed to process profile"))
            }
            Ok(Ok(Err(e))) => {
                log::error!("Failed to decode profile: {}", e);
                Err(Status::internal("Failed to decode profile"))
            }
            Ok(Err(e)) => {
                log::error!("Profile processing failed: {}", e);
                Err(Status::internal("Profile processing failed"))
            }
            Err(_) => Err(Status::deadline_exceeded("Profile processing timed out")),
        }
    }
}
