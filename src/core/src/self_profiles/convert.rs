// Copyright 2026 OpenObserve Inc.
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

use std::{collections::HashMap, io::Read};

use flate2::read::GzDecoder;
use opentelemetry_proto::tonic::{
    collector::profiles::v1development::ExportProfilesServiceRequest,
    common::v1::{AnyValue, KeyValue, any_value},
    profiles::v1development::{
        Function, Line, Location, Mapping, Profile, ProfilesDictionary, ResourceProfiles, Sample,
        ScopeProfiles, Stack, ValueType,
    },
    resource::v1::Resource,
};
use pprof::protos::{Message, Profile as PprofProfile};
use prost::Message as ProstMessage;

use super::SERVICE_NAME;

struct StringTable {
    table: Vec<String>,
    index: HashMap<String, i32>,
}

impl StringTable {
    fn new() -> Self {
        let mut index = HashMap::new();
        index.insert(String::new(), 0);
        Self {
            table: vec![String::new()],
            index,
        }
    }

    fn intern(&mut self, s: &str) -> i32 {
        if let Some(&idx) = self.index.get(s) {
            return idx;
        }
        let idx = self.table.len() as i32;
        self.table.push(s.to_string());
        self.index.insert(s.to_string(), idx);
        idx
    }

    fn lookup_pprof(&mut self, src: &PprofProfile, pprof_idx: i64) -> i32 {
        let s = src
            .string_table
            .get(pprof_idx as usize)
            .map(|s| s.as_str())
            .unwrap_or("");
        self.intern(s)
    }
}

/// Convert raw pprof protobuf bytes into an OTLP Profiles export request.
///
/// Accepts either uncompressed protobuf (CPU `pprof` crate) or gzip-compressed
/// protobuf (jemalloc_pprof heap dumps).
pub fn pprof_bytes_to_otlp(
    pprof_bytes: &[u8],
    extra_resource_attrs: &[(&str, &str)],
) -> Result<ExportProfilesServiceRequest, String> {
    let decoded = decode_pprof_bytes(pprof_bytes)?;
    let src = PprofProfile::parse_from_bytes(&decoded)
        .map_err(|e| format!("Failed to decode pprof profile: {e}"))?;
    pprof_to_otlp(&src, extra_resource_attrs)
}

/// jemalloc_pprof returns gzip; the CPU profiler writes raw protobuf.
fn decode_pprof_bytes(pprof_bytes: &[u8]) -> Result<Vec<u8>, String> {
    if pprof_bytes.starts_with(&[0x1f, 0x8b]) {
        let mut decoder = GzDecoder::new(pprof_bytes);
        let mut decoded = Vec::new();
        decoder
            .read_to_end(&mut decoded)
            .map_err(|e| format!("Failed to gunzip pprof profile: {e}"))?;
        return Ok(decoded);
    }
    Ok(pprof_bytes.to_vec())
}

fn pprof_to_otlp(
    src: &PprofProfile,
    extra_resource_attrs: &[(&str, &str)],
) -> Result<ExportProfilesServiceRequest, String> {
    let mut strings = StringTable::new();

    let mut mapping_table = vec![Mapping::default()];
    let mut mapping_id_to_idx: HashMap<u64, i32> = HashMap::new();
    for m in &src.mapping {
        let idx = mapping_table.len() as i32;
        mapping_id_to_idx.insert(m.id, idx);
        mapping_table.push(Mapping {
            memory_start: m.memory_start,
            memory_limit: m.memory_limit,
            file_offset: m.file_offset,
            filename_strindex: strings.lookup_pprof(src, m.filename),
            attribute_indices: Vec::new(),
        });
    }

    let mut function_table = vec![Function::default()];
    let mut function_id_to_idx: HashMap<u64, i32> = HashMap::new();
    for f in &src.function {
        let idx = function_table.len() as i32;
        function_id_to_idx.insert(f.id, idx);
        function_table.push(Function {
            name_strindex: strings.lookup_pprof(src, f.name),
            system_name_strindex: strings.lookup_pprof(src, f.system_name),
            filename_strindex: strings.lookup_pprof(src, f.filename),
            start_line: f.start_line,
        });
    }

    let mut location_table = vec![Location::default()];
    let mut location_id_to_idx: HashMap<u64, i32> = HashMap::new();
    for loc in &src.location {
        let idx = location_table.len() as i32;
        location_id_to_idx.insert(loc.id, idx);
        let mapping_index = mapping_id_to_idx.get(&loc.mapping_id).copied().unwrap_or(0);
        let lines = loc
            .line
            .iter()
            .map(|line| Line {
                function_index: function_id_to_idx
                    .get(&line.function_id)
                    .copied()
                    .unwrap_or(0),
                line: line.line,
                column: 0,
            })
            .collect();
        location_table.push(Location {
            mapping_index,
            address: loc.address,
            lines,
            attribute_indices: Vec::new(),
        });
    }

    let mut stack_table = vec![Stack::default()];
    let mut stack_key_to_idx: HashMap<Vec<i32>, i32> = HashMap::new();

    let type_order: Vec<usize> = if src.sample_type.len() <= 1 {
        (0..src.sample_type.len()).collect()
    } else {
        let mut order: Vec<usize> = (0..src.sample_type.len()).collect();
        let last = order.len() - 1;
        order.swap(0, last);
        order
    };

    let time_unix_nano = if src.time_nanos > 0 {
        src.time_nanos as u64
    } else {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    };
    let duration_nano = src.duration_nanos.max(0) as u64;

    let mut otlp_profiles = Vec::with_capacity(type_order.len());
    for &st_idx in &type_order {
        let st = &src.sample_type[st_idx];
        let type_strindex = strings.lookup_pprof(src, st.ty);
        let unit_strindex = strings.lookup_pprof(src, st.unit);

        let mut samples = Vec::with_capacity(src.sample.len());
        for sample in &src.sample {
            let location_indices: Vec<i32> = sample
                .location_id
                .iter()
                .map(|id| location_id_to_idx.get(id).copied().unwrap_or(0))
                .collect();
            let stack_index = if let Some(&idx) = stack_key_to_idx.get(&location_indices) {
                idx
            } else {
                let idx = stack_table.len() as i32;
                stack_key_to_idx.insert(location_indices.clone(), idx);
                stack_table.push(Stack { location_indices });
                idx
            };
            let value = sample.value.get(st_idx).copied().unwrap_or(0);
            samples.push(Sample {
                stack_index,
                attribute_indices: Vec::new(),
                link_index: 0,
                values: vec![value],
                timestamps_unix_nano: Vec::new(),
            });
        }

        let period_type = src.period_type.as_ref().map(|pt| ValueType {
            type_strindex: strings.lookup_pprof(src, pt.ty),
            unit_strindex: strings.lookup_pprof(src, pt.unit),
        });

        otlp_profiles.push(Profile {
            sample_type: Some(ValueType {
                type_strindex,
                unit_strindex,
            }),
            samples,
            time_unix_nano,
            duration_nano,
            period_type,
            period: src.period,
            profile_id: Vec::new(),
            dropped_attributes_count: 0,
            original_payload_format: String::new(),
            original_payload: Vec::new(),
            attribute_indices: Vec::new(),
        });
    }

    let mut attributes = vec![string_attr("service.name", SERVICE_NAME)];
    for (k, v) in extra_resource_attrs {
        attributes.push(string_attr(k, v));
    }

    let dictionary = ProfilesDictionary {
        mapping_table,
        location_table,
        function_table,
        link_table: vec![Default::default()],
        string_table: strings.table,
        attribute_table: vec![Default::default()],
        stack_table,
    };

    Ok(ExportProfilesServiceRequest {
        resource_profiles: vec![ResourceProfiles {
            resource: Some(Resource {
                attributes,
                dropped_attributes_count: 0,
                entity_refs: Vec::new(),
            }),
            scope_profiles: vec![ScopeProfiles {
                scope: None,
                profiles: otlp_profiles,
                schema_url: String::new(),
            }],
            schema_url: String::new(),
        }],
        dictionary: Some(dictionary),
    })
}

fn string_attr(key: &str, value: &str) -> KeyValue {
    KeyValue {
        key: key.to_string(),
        value: Some(AnyValue {
            value: Some(any_value::Value::StringValue(value.to_string())),
        }),
        ..Default::default()
    }
}

/// Encode an OTLP export request to protobuf bytes.
pub fn encode_otlp_request(req: &ExportProfilesServiceRequest) -> Vec<u8> {
    let mut buf = Vec::with_capacity(req.encoded_len());
    req.encode(&mut buf)
        .expect("encode ExportProfilesServiceRequest");
    buf
}

#[cfg(test)]
mod tests {
    use pprof::protos::{
        Function as PprofFunction, Line as PprofLine, Location as PprofLocation,
        Mapping as PprofMapping, Sample as PprofSample, ValueType as PprofValueType,
    };

    use super::*;

    fn minimal_pprof_bytes() -> Vec<u8> {
        let mut profile = PprofProfile::new();
        profile.sample_type = vec![PprofValueType {
            ty: 1,
            unit: 2,
            special_fields: Default::default(),
        }];
        profile.sample = vec![PprofSample {
            location_id: vec![1],
            value: vec![42],
            label: Default::default(),
            special_fields: Default::default(),
        }];
        profile.mapping = vec![PprofMapping {
            id: 1,
            memory_start: 0x1000,
            memory_limit: 0x2000,
            file_offset: 0,
            filename: 3,
            build_id: 0,
            has_functions: true,
            has_filenames: false,
            has_line_numbers: false,
            has_inline_frames: false,
            special_fields: Default::default(),
        }];
        profile.location = vec![PprofLocation {
            id: 1,
            mapping_id: 1,
            address: 0x1100,
            line: vec![PprofLine {
                function_id: 1,
                line: 10,
                special_fields: Default::default(),
            }],
            is_folded: false,
            special_fields: Default::default(),
        }];
        profile.function = vec![PprofFunction {
            id: 1,
            name: 4,
            system_name: 4,
            filename: 3,
            start_line: 1,
            special_fields: Default::default(),
        }];
        profile.string_table = vec![
            "".to_string(),
            "samples".to_string(),
            "count".to_string(),
            "openobserve".to_string(),
            "main".to_string(),
        ];
        profile.time_nanos = 1_700_000_000_000_000_000;
        profile.duration_nanos = 5_000_000_000;
        let mut buf = Vec::new();
        profile.write_to_vec(&mut buf).unwrap();
        buf
    }

    #[test]
    fn converts_minimal_pprof_to_otlp() {
        let bytes = minimal_pprof_bytes();
        let req = pprof_bytes_to_otlp(&bytes, &[("host.name", "test-host")]).unwrap();
        assert_eq!(req.resource_profiles.len(), 1);
        let rp = &req.resource_profiles[0];
        assert!(rp.resource.is_some());
        let attrs = &rp.resource.as_ref().unwrap().attributes;
        assert!(attrs.iter().any(|a| a.key == "service.name"));
        assert!(attrs.iter().any(|a| a.key == "host.name"));
        assert_eq!(rp.scope_profiles[0].profiles.len(), 1);
        assert_eq!(rp.scope_profiles[0].profiles[0].samples.len(), 1);
        assert_eq!(rp.scope_profiles[0].profiles[0].samples[0].values, vec![42]);
        let dict = req.dictionary.as_ref().unwrap();
        assert_eq!(dict.string_table[0], "");
        assert!(dict.function_table.len() > 1);
        assert!(dict.location_table.len() > 1);
        assert!(dict.stack_table.len() > 1);
    }

    #[test]
    fn converts_gzipped_pprof_like_jemalloc() {
        use std::io::Write;

        use flate2::{Compression, write::GzEncoder};

        let raw = minimal_pprof_bytes();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&raw).unwrap();
        let gzipped = encoder.finish().unwrap();
        assert!(gzipped.starts_with(&[0x1f, 0x8b]));
        let req = pprof_bytes_to_otlp(&gzipped, &[]).unwrap();
        assert_eq!(
            req.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].values,
            vec![42]
        );
    }

    #[test]
    fn encode_round_trips_length() {
        let req = pprof_bytes_to_otlp(&minimal_pprof_bytes(), &[]).unwrap();
        let encoded = encode_otlp_request(&req);
        assert!(!encoded.is_empty());
        let decoded = ExportProfilesServiceRequest::decode(encoded.as_slice()).unwrap();
        assert_eq!(decoded.resource_profiles.len(), 1);
    }
}
