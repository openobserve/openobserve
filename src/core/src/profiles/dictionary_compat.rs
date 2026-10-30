// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

use opentelemetry_proto::tonic::{
    collector::profiles::v1development::ExportProfilesServiceRequest,
    common::v1::{AnyValue, KeyValue, any_value::Value},
    profiles::v1development::{Location, ProfilesDictionary, ValueType},
};

use super::validation;

struct Offsets {
    mapping: i32,
    location: i32,
    function: i32,
    link: i32,
    string: i32,
    attribute: i32,
    stack: i32,
}

impl Offsets {
    fn new(dictionary: &ProfilesDictionary) -> Self {
        Self {
            mapping: table_offset(&dictionary.mapping_table),
            location: table_offset(&dictionary.location_table),
            function: table_offset(&dictionary.function_table),
            link: table_offset(&dictionary.link_table),
            string: table_offset(&dictionary.string_table),
            attribute: i32::from(
                dictionary
                    .attribute_table
                    .first()
                    .is_some_and(|a| !validation::is_zero_attribute(a)),
            ),
            stack: table_offset(&dictionary.stack_table),
        }
    }

    fn value_type(&self, value: &mut Option<ValueType>) {
        if let Some(value) = value {
            value.type_strindex += self.string;
            value.unit_strindex += self.string;
        }
    }

    fn key_values(&self, attributes: &mut [KeyValue]) {
        for attribute in attributes {
            if attribute.key.is_empty() {
                attribute.key_strindex += self.string;
            }
            if let Some(value) = &mut attribute.value {
                self.value(value);
            }
        }
    }

    fn value(&self, value: &mut AnyValue) {
        match value.value.as_mut() {
            Some(Value::StringValueStrindex(index)) => *index += self.string,
            Some(Value::ArrayValue(array)) => {
                for value in &mut array.values {
                    self.value(value);
                }
            }
            Some(Value::KvlistValue(list)) => self.key_values(&mut list.values),
            _ => {}
        }
    }

    fn dictionary(&self, dictionary: &mut ProfilesDictionary) {
        for mapping in dictionary
            .mapping_table
            .iter_mut()
            .skip(usize::from(self.mapping == 0))
        {
            mapping.filename_strindex += self.string;
            shift_indices(&mut mapping.attribute_indices, self.attribute);
        }
        for location in dictionary
            .location_table
            .iter_mut()
            .skip(usize::from(self.location == 0))
        {
            location.mapping_index += self.mapping;
            shift_indices(&mut location.attribute_indices, self.attribute);
            for line in &mut location.lines {
                line.function_index += self.function;
            }
        }
        for function in dictionary
            .function_table
            .iter_mut()
            .skip(usize::from(self.function == 0))
        {
            function.name_strindex += self.string;
            function.system_name_strindex += self.string;
            function.filename_strindex += self.string;
        }
        for attribute in dictionary
            .attribute_table
            .iter_mut()
            .skip(usize::from(self.attribute == 0))
        {
            attribute.key_strindex += self.string;
            attribute.unit_strindex += self.string;
            if let Some(value) = &mut attribute.value {
                self.value(value);
            }
        }
        for stack in dictionary
            .stack_table
            .iter_mut()
            .skip(usize::from(self.stack == 0))
        {
            shift_indices(&mut stack.location_indices, self.location);
        }
        prepend_zero(&mut dictionary.mapping_table, self.mapping);
        prepend_zero(&mut dictionary.location_table, self.location);
        prepend_zero(&mut dictionary.function_table, self.function);
        prepend_zero(&mut dictionary.link_table, self.link);
        prepend_zero(&mut dictionary.string_table, self.string);
        prepend_zero(&mut dictionary.attribute_table, self.attribute);
        prepend_zero(&mut dictionary.stack_table, self.stack);
    }

    fn resources(&self, request: &mut ExportProfilesServiceRequest) {
        for resource in &mut request.resource_profiles {
            if let Some(resource) = &mut resource.resource {
                self.key_values(&mut resource.attributes);
            }
            for scope in &mut resource.scope_profiles {
                if let Some(scope) = &mut scope.scope {
                    self.key_values(&mut scope.attributes);
                }
                for profile in &mut scope.profiles {
                    self.value_type(&mut profile.sample_type);
                    self.value_type(&mut profile.period_type);
                    shift_indices(&mut profile.attribute_indices, self.attribute);
                    for sample in &mut profile.samples {
                        sample.stack_index += self.stack;
                        sample.link_index += self.link;
                        shift_indices(&mut sample.attribute_indices, self.attribute);
                    }
                }
            }
        }
    }
}

pub(super) fn normalize(request: &mut ExportProfilesServiceRequest) -> Result<(), String> {
    let Some(dictionary) = request.dictionary.as_ref() else {
        return Ok(());
    };
    // Collector 0.153 can compact dictionaries so index zero contains referenced data.
    if !dictionary
        .string_table
        .first()
        .is_some_and(|s| !s.is_empty())
        || !dictionary
            .stack_table
            .first()
            .is_some_and(|s| !s.location_indices.is_empty())
        || !dictionary
            .location_table
            .first()
            .is_some_and(|location| location != &Location::default())
    {
        return Ok(());
    }
    validation::validate_compacted(request)?;
    let offsets = Offsets::new(dictionary);
    offsets.resources(request);
    offsets.dictionary(request.dictionary.as_mut().unwrap());
    Ok(())
}

fn shift_indices(indices: &mut [i32], offset: i32) {
    for index in indices {
        *index += offset;
    }
}

fn table_offset<T: Default + PartialEq>(table: &[T]) -> i32 {
    i32::from(table.first().is_some_and(|entry| entry != &T::default()))
}

fn prepend_zero<T: Default>(table: &mut Vec<T>, offset: i32) {
    if offset != 0 {
        table.insert(0, T::default());
    }
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::common::v1::{ArrayValue, KeyValueList};
    use prost::Message;

    use super::{super::otlp_json_compat, *};

    #[test]
    fn compacted_json_and_protobuf_preserve_zero_index_frames_and_weights() {
        let json = compacted_request();
        let proto = ExportProfilesServiceRequest::decode(json.encode_to_vec().as_slice()).unwrap();
        for mut request in [json, proto] {
            normalize(&mut request).unwrap();
            validation::validate(&request).unwrap();
            let dictionary = request.dictionary.as_ref().unwrap();
            let resource = &request.resource_profiles[0];
            let scope = &resource.scope_profiles[0];
            let profile = &scope.profiles[0];
            assert_eq!(profile.samples[0].stack_index, 1);
            assert_eq!(profile.samples[0].link_index, 0);
            assert_eq!(dictionary.stack_table[1].location_indices[0], 1);
            assert_eq!(dictionary.location_table[1].lines[0].function_index, 1);
            assert_eq!(dictionary.location_table[1].mapping_index, 1);
            let (records, rejected) = super::super::build_sample_records(
                resource,
                scope,
                profile,
                Some(dictionary),
                0,
                i64::MAX,
            );
            assert_eq!(rejected, 0);
            assert_eq!(records.len(), 2);
            assert_eq!(records[0]["value"], 30_000_000);
            assert_eq!(records[0]["profile_type"], "cpu");
            assert_eq!(records[0]["profile_unit"], "nanoseconds");
            assert_eq!(records[0]["service_name"], "test-service");
            assert!(records[0]["stack"].as_str().unwrap().starts_with("leaf;"));
            assert_eq!(records[0]["frame_count"], 5);
            let normalized = request.clone();
            normalize(&mut request).unwrap();
            assert_eq!(request, normalized);
        }
    }

    #[test]
    fn compacted_negative_and_out_of_bounds_indices_are_rejected_before_rebasing() {
        for index in [-1, i32::MAX] {
            let mut request = compacted_request();
            request.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].stack_index =
                index;
            let original = request.clone();
            assert!(normalize(&mut request).unwrap_err().contains("stack_index"));
            assert_eq!(request, original);
            let mut request = compacted_request();
            request.dictionary.as_mut().unwrap().location_table[0].lines[0].function_index = index;
            assert!(
                normalize(&mut request)
                    .unwrap_err()
                    .contains("function_index")
            );
        }
    }

    #[test]
    fn compacted_links_and_nested_dictionary_attributes_are_rebased() {
        let mut request = compacted_request();
        request.dictionary.as_mut().unwrap().link_table =
            vec![opentelemetry_proto::tonic::profiles::v1development::Link {
                trace_id: vec![1; 16],
                span_id: vec![2; 8],
            }];
        let nested = AnyValue {
            value: Some(Value::ArrayValue(ArrayValue {
                values: vec![AnyValue {
                    value: Some(Value::KvlistValue(KeyValueList {
                        values: vec![KeyValue {
                            key_strindex: 0,
                            value: Some(AnyValue {
                                value: Some(Value::StringValueStrindex(0)),
                            }),
                            ..Default::default()
                        }],
                    })),
                }],
            })),
        };
        request.dictionary.as_mut().unwrap().attribute_table[0].value = Some(nested);
        normalize(&mut request).unwrap();
        validation::validate(&request).unwrap();
        let dictionary = request.dictionary.as_ref().unwrap();
        assert_eq!(
            request.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].link_index,
            1
        );
        assert_eq!(
            super::super::resolve_link(1, Some(dictionary)).0.unwrap(),
            "01".repeat(16)
        );
        let value = dictionary.attribute_table[1].value.as_ref().unwrap();
        let Some(Value::ArrayValue(array)) = &value.value else {
            panic!("expected array")
        };
        let Some(Value::KvlistValue(list)) = &array.values[0].value else {
            panic!("expected kvlist")
        };
        assert_eq!(list.values[0].key_strindex, 1);
        assert_eq!(
            list.values[0].value.as_ref().unwrap().value,
            Some(Value::StringValueStrindex(1))
        );
    }

    #[test]
    fn retained_optional_sentinels_do_not_become_synthetic_functions_or_mappings() {
        let mut request = compacted_request();
        let dictionary = request.dictionary.as_mut().unwrap();
        dictionary.function_table[0] = Default::default();
        dictionary.mapping_table.insert(0, Default::default());
        for location in &mut dictionary.location_table {
            location.mapping_index += 1;
        }
        dictionary.link_table = vec![Default::default()];
        dictionary.attribute_table[0] = Default::default();
        normalize(&mut request).unwrap();
        validation::validate(&request).unwrap();
        let dictionary = request.dictionary.as_ref().unwrap();
        assert_eq!(dictionary.mapping_table[0], Default::default());
        assert_eq!(dictionary.function_table[0], Default::default());
        assert_eq!(dictionary.attribute_table[0], Default::default());
        assert_eq!(dictionary.location_table[1].mapping_index, 1);
        assert_eq!(dictionary.location_table[1].lines[0].function_index, 0);
        assert_eq!(
            request.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].link_index,
            0
        );
        let (stack, _) = super::super::resolve_stack(1, Some(dictionary));
        assert!(!stack.contains(&dictionary.string_table[1]));
    }

    #[test]
    fn canonical_exports_and_malformed_canonical_sentinels_are_unchanged() {
        let mut request = compacted_request();
        normalize(&mut request).unwrap();
        let canonical = request.clone();
        normalize(&mut request).unwrap();
        assert_eq!(request, canonical);
        request.dictionary.as_mut().unwrap().stack_table[0].location_indices = vec![1];
        let malformed = request.clone();
        normalize(&mut request).unwrap();
        assert_eq!(request, malformed);
        assert_eq!(
            validation::validate(&request).unwrap_err(),
            "dictionary.stack_table[0] must be the zero value"
        );
        let mut empty = ExportProfilesServiceRequest::default();
        normalize(&mut empty).unwrap();
        validation::validate(&empty).unwrap();
    }

    fn compacted_request() -> ExportProfilesServiceRequest {
        let mut payload = serde_json::json!({
            "dictionary": {
                "stringTable": ["leaf", "caller", "worker", "loop", "root", "cpu",
                    "nanoseconds", "service.name", "test-service", "demo", "build_id"],
                "mappingTable": [{"filenameStrindex": 9, "attributeIndices": [0]}],
                "locationTable": (0..5).map(|index| serde_json::json!({
                    "address": index + 1,
                    "mappingIndex": 0,
                    "lines": [{"functionIndex": index}]
                })).collect::<Vec<_>>(),
                "functionTable": (0..5).map(|index| serde_json::json!({
                    "nameStrindex": index, "systemNameStrindex": index, "filenameStrindex": 9
                })).collect::<Vec<_>>(),
                "attributeTable": [{"keyStrindex": 10, "value": {"stringValue": "demo"}}],
                "stackTable": [{"locationIndices": [0, 1, 2, 3, 4]}, {"locationIndices": [4]}]
            },
            "resourceProfiles": [{
                "resource": {"attributes": [{"keyStrindex": 7, "value": {"stringValueStrindex": 8}}]},
                "scopeProfiles": [{"profiles": [{
                    "sampleType": {"typeStrindex": 5, "unitStrindex": 6},
                    "periodType": {"typeStrindex": 5, "unitStrindex": 6},
                    "timeUnixNano": "1000000000", "durationNano": "1000000000", "period": "10000000",
                    "attributeIndices": [0],
                    "samples": [{"stackIndex": 0, "values": ["30000000"]},
                        {"stackIndex": 1, "values": ["10000000"]}]
                }]}]
            }]
        });
        otlp_json_compat::normalize(&mut payload);
        otlp_json_compat::deserialize(payload).unwrap()
    }
}
