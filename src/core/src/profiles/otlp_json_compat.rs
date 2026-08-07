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

//! Soft-normalizes OTLP/JSON profiles payloads for serde.
//!
//! OTLP/JSON uses camelCase ([OTLP spec](https://opentelemetry.io/docs/specs/otlp/)).
//! This layer fills missing defaults and coerces stringified integers —
//! it does not rewrite field names.
//!
//! Several profiles protobuf messages lack `#[serde(default)]`, so omitted
//! ProtoJSON defaults (empty `resourceProfiles`, zero `timeUnixNano` /
//! `durationNano`, `mappingIndex`, etc.) fail deserialization without this pass.

use config::utils::json;

const INTEGRAL_KEYS: &[&str] = &[
    "timeUnixNano",
    "durationNano",
    "period",
    "linkIndex",
    "typeStrindex",
    "unitStrindex",
    "stackIndex",
    "mappingIndex",
    "functionIndex",
    "address",
    "line",
    "column",
    "nameStrindex",
    "systemNameStrindex",
    "filenameStrindex",
    "startLine",
    "keyStrindex",
    "unitStrindex",
    "stringValueStrindex",
    "intValue",
    "droppedAttributesCount",
    "memoryStart",
    "memoryLimit",
    "fileOffset",
];

const INTEGRAL_ARRAY_KEYS: &[&str] = &[
    "values",
    "locationIndices",
    "attributeIndices",
    "timestampsUnixNano",
];

pub fn normalize(body: &mut json::Value) {
    normalize_value(body);
    ensure_defaults(body);
}

fn normalize_value(value: &mut json::Value) {
    match value {
        json::Value::Array(items) => {
            for item in items {
                normalize_value(item);
            }
        }
        json::Value::Object(map) => {
            for child in map.values_mut() {
                normalize_value(child);
            }
            normalize_integral_fields(map);
            normalize_integral_arrays(map);
            normalize_raw_bytes_fields(map);
        }
        _ => {}
    }
}

fn normalize_integral_fields(map: &mut json::Map<String, json::Value>) {
    for key in INTEGRAL_KEYS {
        let Some(value) = map.get_mut(*key) else {
            continue;
        };
        coerce_integral_value(value);
    }
}

fn normalize_integral_arrays(map: &mut json::Map<String, json::Value>) {
    for key in INTEGRAL_ARRAY_KEYS {
        let Some(json::Value::Array(items)) = map.get_mut(*key) else {
            continue;
        };
        for item in items.iter_mut() {
            coerce_integral_value(item);
        }
    }
}

fn coerce_integral_value(value: &mut json::Value) {
    let Some(raw) = value.as_str() else {
        return;
    };
    if let Ok(v) = raw.parse::<u64>() {
        *value = json::Value::from(v);
        return;
    }
    if let Ok(v) = raw.parse::<i64>() {
        *value = json::Value::from(v);
    }
}

/// `Link.trace_id` / `span_id` / `Profile.original_payload` are bare `Vec<u8>`
/// (JSON array), unlike `profileId` which uses hex-string serde helpers.
fn normalize_raw_bytes_fields(map: &mut json::Map<String, json::Value>) {
    for key in ["traceId", "spanId", "originalPayload"] {
        let Some(value) = map.get_mut(key) else {
            continue;
        };
        match value {
            json::Value::String(raw) => {
                if raw.is_empty() {
                    *value = json::Value::Array(vec![]);
                    continue;
                }
                if let Some(bytes) = decode_hex(raw) {
                    *value = json::Value::Array(bytes.into_iter().map(json::Value::from).collect());
                }
            }
            json::Value::Null => {
                *value = json::Value::Array(vec![]);
            }
            _ => {}
        }
    }
}

fn decode_hex(raw: &str) -> Option<Vec<u8>> {
    let raw = raw.strip_prefix("0x").unwrap_or(raw);
    if !raw.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(raw.len() / 2);
    for i in (0..raw.len()).step_by(2) {
        out.push(u8::from_str_radix(&raw[i..i + 2], 16).ok()?);
    }
    Some(out)
}

fn ensure_defaults(body: &mut json::Value) {
    if let Some(root) = body.as_object_mut() {
        root.entry("resourceProfiles".to_string())
            .or_insert_with(|| json::Value::Array(vec![]));
    }
    ensure_dictionary_defaults(body);
    ensure_profile_defaults(body);
}

fn ensure_dictionary_defaults(body: &mut json::Value) {
    let Some(dictionary) = body.get_mut("dictionary") else {
        return;
    };
    let Some(dictionary) = dictionary.as_object_mut() else {
        return;
    };

    for key in [
        "mappingTable",
        "locationTable",
        "functionTable",
        "attributeTable",
        "stackTable",
        "linkTable",
        "stringTable",
    ] {
        dictionary
            .entry(key.to_string())
            .or_insert_with(|| json::Value::Array(vec![]));
    }

    if let Some(json::Value::Array(locations)) = dictionary.get_mut("locationTable") {
        for location in locations.iter_mut() {
            ensure_location_defaults(location);
        }
    }
    if let Some(json::Value::Array(functions)) = dictionary.get_mut("functionTable") {
        for function in functions.iter_mut() {
            ensure_function_defaults(function);
        }
    }
    if let Some(json::Value::Array(mappings)) = dictionary.get_mut("mappingTable") {
        for mapping in mappings.iter_mut() {
            ensure_mapping_defaults(mapping);
        }
    }
    if let Some(json::Value::Array(links)) = dictionary.get_mut("linkTable") {
        for link in links.iter_mut() {
            ensure_link_defaults(link);
        }
    }
    if let Some(json::Value::Array(attrs)) = dictionary.get_mut("attributeTable") {
        for attr in attrs.iter_mut() {
            ensure_attribute_defaults(attr);
        }
    }
    if let Some(json::Value::Array(stacks)) = dictionary.get_mut("stackTable") {
        for stack in stacks.iter_mut() {
            ensure_stack_defaults(stack);
        }
    }
}

fn ensure_location_defaults(location: &mut json::Value) {
    let Some(location) = location.as_object_mut() else {
        return;
    };
    location
        .entry("mappingIndex".to_string())
        .or_insert_with(|| json::Value::from(0));
    location
        .entry("address".to_string())
        .or_insert_with(|| json::Value::from(0));
    location
        .entry("lines".to_string())
        .or_insert_with(|| json::Value::Array(vec![]));
    location
        .entry("attributeIndices".to_string())
        .or_insert_with(|| json::Value::Array(vec![]));

    if let Some(json::Value::Array(lines)) = location.get_mut("lines") {
        for line in lines.iter_mut() {
            ensure_line_defaults(line);
        }
    }
}

fn ensure_line_defaults(line: &mut json::Value) {
    let Some(line) = line.as_object_mut() else {
        return;
    };
    line.entry("functionIndex".to_string())
        .or_insert_with(|| json::Value::from(0));
    line.entry("line".to_string())
        .or_insert_with(|| json::Value::from(0));
    line.entry("column".to_string())
        .or_insert_with(|| json::Value::from(0));
}

fn ensure_function_defaults(function: &mut json::Value) {
    let Some(function) = function.as_object_mut() else {
        return;
    };
    function
        .entry("nameStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
    function
        .entry("systemNameStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
    function
        .entry("filenameStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
    function
        .entry("startLine".to_string())
        .or_insert_with(|| json::Value::from(0));
}

fn ensure_mapping_defaults(mapping: &mut json::Value) {
    let Some(mapping) = mapping.as_object_mut() else {
        return;
    };
    mapping
        .entry("memoryStart".to_string())
        .or_insert_with(|| json::Value::from(0));
    mapping
        .entry("memoryLimit".to_string())
        .or_insert_with(|| json::Value::from(0));
    mapping
        .entry("fileOffset".to_string())
        .or_insert_with(|| json::Value::from(0));
    mapping
        .entry("filenameStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
    mapping
        .entry("attributeIndices".to_string())
        .or_insert_with(|| json::Value::Array(vec![]));
}

fn ensure_link_defaults(link: &mut json::Value) {
    let Some(link) = link.as_object_mut() else {
        return;
    };
    // Bare Vec<u8> fields — empty JSON array.
    link.entry("traceId".to_string())
        .or_insert_with(|| json::Value::Array(vec![]));
    link.entry("spanId".to_string())
        .or_insert_with(|| json::Value::Array(vec![]));
}

fn ensure_attribute_defaults(attr: &mut json::Value) {
    let Some(attr) = attr.as_object_mut() else {
        return;
    };
    attr.entry("keyStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
    attr.entry("unitStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
}

fn ensure_stack_defaults(stack: &mut json::Value) {
    let Some(stack) = stack.as_object_mut() else {
        return;
    };
    stack
        .entry("locationIndices".to_string())
        .or_insert_with(|| json::Value::Array(vec![]));
}

fn ensure_profile_defaults(body: &mut json::Value) {
    let Some(resource_profiles) = body
        .get_mut("resourceProfiles")
        .and_then(json::Value::as_array_mut)
    else {
        return;
    };

    for resource_profile in resource_profiles {
        if let Some(resource_profile_obj) = resource_profile.as_object_mut() {
            resource_profile_obj
                .entry("schemaUrl".to_string())
                .or_insert_with(|| json::Value::String(String::new()));
        }

        let Some(scope_profiles) = resource_profile
            .get_mut("scopeProfiles")
            .and_then(json::Value::as_array_mut)
        else {
            continue;
        };

        for scope_profile in scope_profiles {
            if let Some(scope_profile_obj) = scope_profile.as_object_mut() {
                scope_profile_obj
                    .entry("schemaUrl".to_string())
                    .or_insert_with(|| json::Value::String(String::new()));
            }

            let Some(profiles) = scope_profile
                .get_mut("profiles")
                .and_then(json::Value::as_array_mut)
            else {
                continue;
            };

            for profile in profiles {
                let Some(profile) = profile.as_object_mut() else {
                    continue;
                };
                // ProtoJSON omits zero defaults; serde without #[serde(default)]
                // requires these fields to be present.
                profile
                    .entry("timeUnixNano".to_string())
                    .or_insert_with(|| json::Value::from(0));
                profile
                    .entry("durationNano".to_string())
                    .or_insert_with(|| json::Value::from(0));
                profile
                    .entry("period".to_string())
                    .or_insert_with(|| json::Value::from(0));
                profile
                    .entry("samples".to_string())
                    .or_insert_with(|| json::Value::Array(vec![]));
                profile
                    .entry("profileId".to_string())
                    .or_insert_with(|| json::Value::String(String::new()));
                profile
                    .entry("droppedAttributesCount".to_string())
                    .or_insert_with(|| json::Value::from(0));
                profile
                    .entry("attributeIndices".to_string())
                    .or_insert_with(|| json::Value::Array(vec![]));
                profile
                    .entry("originalPayloadFormat".to_string())
                    .or_insert_with(|| json::Value::String(String::new()));
                profile
                    .entry("originalPayload".to_string())
                    .or_insert_with(|| json::Value::Array(vec![]));

                if let Some(sample_type) = profile.get_mut("sampleType") {
                    ensure_value_type_defaults(sample_type);
                }
                if let Some(period_type) = profile.get_mut("periodType") {
                    ensure_value_type_defaults(period_type);
                }

                if let Some(samples) = profile
                    .get_mut("samples")
                    .and_then(json::Value::as_array_mut)
                {
                    for sample in samples {
                        let Some(sample) = sample.as_object_mut() else {
                            continue;
                        };
                        sample
                            .entry("stackIndex".to_string())
                            .or_insert_with(|| json::Value::from(0));
                        sample
                            .entry("linkIndex".to_string())
                            .or_insert_with(|| json::Value::from(0));
                        sample
                            .entry("attributeIndices".to_string())
                            .or_insert_with(|| json::Value::Array(vec![]));
                        sample
                            .entry("values".to_string())
                            .or_insert_with(|| json::Value::Array(vec![]));
                        sample
                            .entry("timestampsUnixNano".to_string())
                            .or_insert_with(|| json::Value::Array(vec![]));
                    }
                }
            }
        }
    }
}

fn ensure_value_type_defaults(value_type: &mut json::Value) {
    let Some(value_type) = value_type.as_object_mut() else {
        return;
    };
    value_type
        .entry("typeStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
    value_type
        .entry("unitStrindex".to_string())
        .or_insert_with(|| json::Value::from(0));
}

#[cfg(test)]
mod tests {
    use config::utils::json;
    use opentelemetry_proto::tonic::collector::profiles::v1development::ExportProfilesServiceRequest;

    use super::normalize;

    #[test]
    fn accepts_standard_otlp_json_camel_case() {
        let mut payload = json::json!({
            "resourceProfiles": [
                {
                    "scopeProfiles": [
                        {
                            "profiles": [
                                {
                                    "timeUnixNano": "1735732800000000000",
                                    "durationNano": "1000000000",
                                    "samples": []
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        normalize(&mut payload);

        let req = serde_json::from_value::<ExportProfilesServiceRequest>(payload)
            .expect("OTLP/JSON camelCase payload should deserialize");
        let profile = &req.resource_profiles[0].scope_profiles[0].profiles[0];
        assert_eq!(profile.time_unix_nano, 1735732800000000000);
        assert_eq!(profile.duration_nano, 1000000000);
        assert_eq!(profile.period, 0);
        assert!(profile.samples.is_empty());
    }

    #[test]
    fn fills_missing_dictionary_tables() {
        let mut payload = json::json!({
            "resourceProfiles": [],
            "dictionary": {
                "linkTable": []
            }
        });

        normalize(&mut payload);

        serde_json::from_value::<ExportProfilesServiceRequest>(payload)
            .expect("dictionary defaults should satisfy serde requirements");
    }

    #[test]
    fn fills_missing_location_mapping_index_like_curl_payload() {
        let mut payload = json::json!({
            "dictionary": {
                "stringTable": ["", "samples", "count", "main"],
                "functionTable": [{}, { "nameStrindex": 3 }],
                "locationTable": [
                    {},
                    { "lines": [{ "functionIndex": 1, "line": 10 }] }
                ],
                "stackTable": [
                    {},
                    { "locationIndices": [1] }
                ],
                "linkTable": [{}],
                "attributeTable": [{}],
                "mappingTable": [{}]
            },
            "resourceProfiles": [
                {
                    "resource": {
                        "attributes": [
                            { "key": "service.name", "value": { "stringValue": "my-service" } }
                        ]
                    },
                    "scopeProfiles": [
                        {
                            "profiles": [
                                {
                                    "sampleType": { "typeStrindex": 1, "unitStrindex": 2 },
                                    "timeUnixNano": "2000000000000000000",
                                    "durationNano": "1000000000",
                                    "period": "50000000",
                                    "samples": [
                                        {
                                            "stackIndex": 1,
                                            "values": ["5"]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        normalize(&mut payload);
        let req = serde_json::from_value::<ExportProfilesServiceRequest>(payload)
            .expect("location without mappingIndex should deserialize after normalize");
        let loc = &req.dictionary.as_ref().unwrap().location_table[1];
        assert_eq!(loc.mapping_index, 0);
        assert_eq!(
            req.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].values,
            vec![5]
        );
    }

    #[test]
    fn accepts_omitted_top_level_resource_profiles() {
        let mut payload = json::json!({});
        normalize(&mut payload);
        let req = serde_json::from_value::<ExportProfilesServiceRequest>(payload)
            .expect("empty object should deserialize after normalize");
        assert!(req.resource_profiles.is_empty());
        assert!(req.dictionary.is_none());
    }

    #[test]
    fn accepts_omitted_zero_profile_time_and_duration() {
        // Instant profiles (e.g. live heap) may omit durationNano=0; timeUnixNano
        // may also be omitted when the sender uses ProtoJSON default-omission.
        let mut payload = json::json!({
            "resourceProfiles": [
                {
                    "scopeProfiles": [
                        {
                            "profiles": [
                                {
                                    "samples": []
                                }
                            ]
                        }
                    ]
                }
            ]
        });
        normalize(&mut payload);
        let req = serde_json::from_value::<ExportProfilesServiceRequest>(payload)
            .expect("profile without timeUnixNano/durationNano should deserialize");
        let profile = &req.resource_profiles[0].scope_profiles[0].profiles[0];
        assert_eq!(profile.time_unix_nano, 0);
        assert_eq!(profile.duration_nano, 0);
    }

    #[test]
    fn converts_link_hex_strings_to_byte_arrays() {
        let mut payload = json::json!({
            "dictionary": {
                "stringTable": [""],
                "linkTable": [
                    {},
                    {
                        "traceId": "1122aabbccddeeff0000000000000000",
                        "spanId": "ff01020304050607"
                    }
                ],
                "locationTable": [{}],
                "functionTable": [{}],
                "stackTable": [{}],
                "attributeTable": [{}],
                "mappingTable": [{}]
            },
            "resourceProfiles": []
        });
        normalize(&mut payload);
        let req = serde_json::from_value::<ExportProfilesServiceRequest>(payload)
            .expect("hex link ids should convert to byte arrays");
        let link = &req.dictionary.as_ref().unwrap().link_table[1];
        assert_eq!(link.trace_id.len(), 16);
        assert_eq!(link.span_id.len(), 8);
        assert_eq!(link.trace_id[0], 0x11);
        assert_eq!(link.span_id[0], 0xff);
    }
}
