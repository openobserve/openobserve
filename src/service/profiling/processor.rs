use std::collections::HashMap;

use bytes::Bytes;
#[cfg(feature = "profiling")]
use pprof::protos::{Message, Profile, Sample};

use super::{
    types::{NormalizedProfile, ProfileError, ProfileMetadata, Result, StreamProfileData},
    PROFILING_STREAM,
};
use crate::{common::meta::ingestion::IngestionRequest, service::logs};

#[derive(Default)]
pub struct ProfileProcessor {
    location_cache: HashMap<u64, u64>,
}

impl ProfileProcessor {
    pub fn new() -> Self {
        Self {
            location_cache: HashMap::new(),
        }
    }

    pub async fn process_profile(
        &mut self,
        raw_profile: &[u8],
        metadata: ProfileMetadata,
    ) -> Result<()> {
        // Decode profile
        let profile =
            Profile::decode(raw_profile).map_err(|e| ProfileError::DecodeError(e.to_string()))?;

        // Build location cache
        self.build_location_cache(&profile);

        // Normalize profile
        let normalized = self.normalize_profile(&profile, metadata)?;

        // Convert samples directly to array of objects
        let json_array = serde_json::to_vec(&normalized.samples)
            .map_err(|e| ProfileError::SerializationError(e.to_string()))?;

        // Convert to Bytes
        let bytes = Bytes::from(json_array);

        // Ingest into stream
        logs::ingest::ingest(
            0,
            "default",
            PROFILING_STREAM,
            IngestionRequest::JSON(&bytes),
            "root@example.com",
            None,
        )
        .await
        .map_err(|e| ProfileError::IngestError(e.to_string()))?;

        Ok(())
    }

    fn build_location_cache(&mut self, profile: &Profile) {
        self.location_cache.clear();
        for location in &profile.location {
            if let Some(line) = location.line.first() {
                self.location_cache.insert(location.id, line.function_id);
            }
        }
    }

    fn build_stack_trace(&self, sample: &Sample, profile: &Profile) -> Result<Vec<String>> {
        let mut stack = Vec::with_capacity(sample.location_id.len());

        for &loc_id in &sample.location_id {
            if let Some(&func_id) = self.location_cache.get(&loc_id) {
                if let Some(function) = profile.function.iter().find(|f| f.id == func_id) {
                    if let Some(name) = profile.string_table.get(function.name as usize) {
                        let clean_name = if name.starts_with("__ZN") {
                            let demangled = rustc_demangle::demangle(name).to_string();
                            demangled
                        } else {
                            name.to_string()
                        };

                        stack.push(clean_name);
                    }
                }
            }
        }

        Ok(stack)
    }

    fn normalize_profile(
        &self,
        profile: &Profile,
        metadata: ProfileMetadata,
    ) -> Result<NormalizedProfile> {
        let mut samples = Vec::with_capacity(profile.sample.len());

        for sample in &profile.sample {
            let stack_trace = self.build_stack_trace(sample, profile)?;

            // For flame graphs, use the leaf function (last in stack)
            if let Some(function_name) = stack_trace.last() {
                samples.push(StreamProfileData {
                    instance_id: metadata.instance_id.clone(),
                    stack_trace: stack_trace.clone(),
                    value: sample.value.first().copied().unwrap_or(0) as u64,
                    metadata: metadata.clone(),
                    stack_depth: stack_trace.len() as i32,
                    leaf_function: function_name.clone(),
                    root_function: stack_trace.first().unwrap_or(&"".to_string()).clone(),
                });
            }
        }

        log::debug!("Normalized {} samples", samples.len());
        Ok(NormalizedProfile { samples })
    }
}
