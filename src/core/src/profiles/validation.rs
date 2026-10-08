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

use std::fmt::{self, Display};

use opentelemetry_proto::tonic::{
    collector::profiles::v1development::ExportProfilesServiceRequest,
    common::v1::{AnyValue, KeyValue, any_value::Value},
    profiles::v1development::{KeyValueAndUnit, Profile, ProfilesDictionary, ValueType},
};

struct Path<'a> {
    parent: Option<&'a Path<'a>>,
    field: &'static str,
    index: Option<usize>,
}

impl Path<'_> {
    fn root(field: &'static str) -> Self {
        Self {
            parent: None,
            field,
            index: None,
        }
    }

    fn field(&self, field: &'static str) -> Path<'_> {
        Path {
            parent: Some(self),
            field,
            index: None,
        }
    }

    fn indexed(&self, field: &'static str, index: usize) -> Path<'_> {
        Path {
            parent: Some(self),
            field,
            index: Some(index),
        }
    }

    fn at(&self, index: usize) -> Path<'_> {
        self.indexed("", index)
    }
}

impl Display for Path<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(parent) = self.parent {
            parent.fmt(f)?;
            if !self.field.is_empty() {
                f.write_str(".")?;
            }
        }
        f.write_str(self.field)?;
        if let Some(index) = self.index {
            write!(f, "[{index}]")?;
        }
        Ok(())
    }
}

struct Validator<'a> {
    dictionary: &'a ProfilesDictionary,
}

impl Validator<'_> {
    fn dictionary(&self) -> Result<(), String> {
        let d = self.dictionary;
        sentinel(&d.mapping_table, "mapping_table")?;
        sentinel(&d.location_table, "location_table")?;
        sentinel(&d.function_table, "function_table")?;
        sentinel(&d.link_table, "link_table")?;
        sentinel(&d.string_table, "string_table")?;
        attribute_sentinel(&d.attribute_table)?;
        sentinel(&d.stack_table, "stack_table")?;
        let root = Path::root("dictionary");
        for (i, mapping) in d.mapping_table.iter().enumerate() {
            let path = root.indexed("mapping_table", i);
            self.string(mapping.filename_strindex, &path.field("filename_strindex"))?;
            self.attributes(&mapping.attribute_indices, &path)?;
        }
        for (i, location) in d.location_table.iter().enumerate() {
            let path = root.indexed("location_table", i);
            index(
                location.mapping_index,
                d.mapping_table.len(),
                path.field("mapping_index"),
            )?;
            self.attributes(&location.attribute_indices, &path)?;
            for (j, line) in location.lines.iter().enumerate() {
                index(
                    line.function_index,
                    d.function_table.len(),
                    path.indexed("lines", j).field("function_index"),
                )?;
            }
        }
        for (i, function) in d.function_table.iter().enumerate() {
            let path = root.indexed("function_table", i);
            self.string(function.name_strindex, &path.field("name_strindex"))?;
            self.string(
                function.system_name_strindex,
                &path.field("system_name_strindex"),
            )?;
            self.string(function.filename_strindex, &path.field("filename_strindex"))?;
        }
        for (i, attribute) in d.attribute_table.iter().enumerate() {
            let path = root.indexed("attribute_table", i);
            self.string(attribute.key_strindex, &path.field("key_strindex"))?;
            self.string(attribute.unit_strindex, &path.field("unit_strindex"))?;
            self.value(attribute.value.as_ref(), &path.field("value"))?;
        }
        for (i, stack) in d.stack_table.iter().enumerate() {
            let path = root.indexed("stack_table", i);
            for (j, &location) in stack.location_indices.iter().enumerate() {
                index(
                    location,
                    d.location_table.len(),
                    path.indexed("location_indices", j),
                )?;
            }
        }
        Ok(())
    }

    fn profile(&self, profile: &Profile, path: &Path<'_>) -> Result<(), String> {
        self.value_type(profile.sample_type.as_ref(), &path.field("sample_type"))?;
        self.value_type(profile.period_type.as_ref(), &path.field("period_type"))?;
        self.attributes(&profile.attribute_indices, path)?;
        for (i, sample) in profile.samples.iter().enumerate() {
            let path = path.indexed("samples", i);
            index(
                sample.stack_index,
                self.dictionary.stack_table.len(),
                path.field("stack_index"),
            )?;
            index(
                sample.link_index,
                self.dictionary.link_table.len(),
                path.field("link_index"),
            )?;
            self.attributes(&sample.attribute_indices, &path)?;
        }
        Ok(())
    }

    fn value_type(&self, value: Option<&ValueType>, path: &Path<'_>) -> Result<(), String> {
        if let Some(value) = value {
            self.string(value.type_strindex, &path.field("type_strindex"))?;
            self.string(value.unit_strindex, &path.field("unit_strindex"))?;
        }
        Ok(())
    }

    fn string(&self, value: i32, path: &Path<'_>) -> Result<(), String> {
        index(value, self.dictionary.string_table.len(), path)
    }

    fn attributes(&self, indices: &[i32], path: &Path<'_>) -> Result<(), String> {
        for (i, &value) in indices.iter().enumerate() {
            index(
                value,
                self.dictionary.attribute_table.len(),
                path.indexed("attribute_indices", i),
            )?;
        }
        Ok(())
    }

    fn key_values(&self, attributes: &[KeyValue], path: &Path<'_>) -> Result<(), String> {
        for (i, attribute) in attributes.iter().enumerate() {
            let path = path.at(i);
            self.string(attribute.key_strindex, &path.field("key_strindex"))?;
            self.value(attribute.value.as_ref(), &path.field("value"))?;
        }
        Ok(())
    }

    fn value(&self, value: Option<&AnyValue>, path: &Path<'_>) -> Result<(), String> {
        match value.and_then(|value| value.value.as_ref()) {
            Some(Value::StringValueStrindex(value)) => {
                self.string(*value, &path.field("string_value_strindex"))
            }
            Some(Value::ArrayValue(array)) => {
                let path = path.field("array_value");
                for (i, value) in array.values.iter().enumerate() {
                    self.value(Some(value), &path.indexed("values", i))?;
                }
                Ok(())
            }
            Some(Value::KvlistValue(list)) => {
                self.key_values(&list.values, &path.field("kvlist_value").field("values"))
            }
            _ => Ok(()),
        }
    }
}

pub(super) fn validate(request: &ExportProfilesServiceRequest) -> Result<(), String> {
    let empty = ProfilesDictionary::default();
    let validator = Validator {
        dictionary: request.dictionary.as_ref().unwrap_or(&empty),
    };
    validator.dictionary()?;
    let root = Path::root("resource_profiles");
    for (i, resource) in request.resource_profiles.iter().enumerate() {
        let path = root.at(i);
        if let Some(resource) = &resource.resource {
            validator.key_values(
                &resource.attributes,
                &path.field("resource").field("attributes"),
            )?;
        }
        for (j, scope) in resource.scope_profiles.iter().enumerate() {
            let path = path.indexed("scope_profiles", j);
            if let Some(scope) = &scope.scope {
                validator
                    .key_values(&scope.attributes, &path.field("scope").field("attributes"))?;
            }
            for (k, profile) in scope.profiles.iter().enumerate() {
                validator.profile(profile, &path.indexed("profiles", k))?;
            }
        }
    }
    Ok(())
}

fn attribute_sentinel(table: &[KeyValueAndUnit]) -> Result<(), String> {
    if table.first().is_some_and(|attribute| {
        attribute.key_strindex != 0
            || attribute.unit_strindex != 0
            || attribute
                .value
                .as_ref()
                .is_some_and(|value| value.value.is_some())
    }) {
        return Err("dictionary.attribute_table[0] must be the zero value".into());
    }
    Ok(())
}

fn sentinel<T: Default + PartialEq>(table: &[T], name: &str) -> Result<(), String> {
    if table.first().is_some_and(|value| value != &T::default()) {
        return Err(format!("dictionary.{name}[0] must be the zero value"));
    }
    Ok(())
}

fn index(value: i32, len: usize, path: impl Display) -> Result<(), String> {
    // Zero remains unset even when an optional dictionary table is omitted.
    if value < 0 || (value > 0 && value as usize >= len) {
        return Err(format!(
            "{path}: index {value} is outside dictionary table length {len}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::{
        common::v1::{ArrayValue, KeyValueList},
        profiles::v1development::{
            Function, KeyValueAndUnit, Line, Link, Location, Mapping, ResourceProfiles, Sample,
            ScopeProfiles, Stack,
        },
    };
    use prost::Message;

    use super::*;

    struct UnformattedPath;

    impl Display for UnformattedPath {
        fn fmt(&self, _: &mut fmt::Formatter<'_>) -> fmt::Result {
            panic!("successful index validation must not format its diagnostic path")
        }
    }

    type DictionaryMutation = (fn(&mut ProfilesDictionary, i32), &'static str);
    type ProfileMutation = (fn(&mut Profile, i32), &'static str);

    #[test]
    fn valid_indexes_do_not_format_diagnostic_paths() {
        assert!(index(0, 0, UnformattedPath).is_ok());
        assert!(index(1, 2, UnformattedPath).is_ok());
    }

    #[test]
    fn lazy_paths_keep_exact_profile_and_nested_attribute_errors() {
        let mut request = valid_request();
        request.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].stack_index = -1;
        assert_eq!(
            validate(&request).unwrap_err(),
            "resource_profiles[0].scope_profiles[0].profiles[0].samples[0].stack_index: index -1 is outside dictionary table length 2"
        );
        request = valid_request();
        request.dictionary.as_mut().unwrap().attribute_table[1].value = Some(AnyValue {
            value: Some(Value::ArrayValue(ArrayValue {
                values: vec![AnyValue {
                    value: Some(Value::KvlistValue(KeyValueList {
                        values: vec![KeyValue {
                            value: Some(string_index(99)),
                            ..Default::default()
                        }],
                    })),
                }],
            })),
        });
        assert_eq!(
            validate(&request).unwrap_err(),
            "dictionary.attribute_table[1].value.array_value.values[0].kvlist_value.values[0].value.string_value_strindex: index 99 is outside dictionary table length 4"
        );
    }

    #[test]
    fn collector_empty_any_value_wire_sentinel_is_accepted() {
        let dictionary = ProfilesDictionary::decode(&[0x32, 0x02, 0x12, 0x00][..]).unwrap();
        assert_eq!(
            dictionary.attribute_table[0].value,
            Some(AnyValue::default())
        );
        let mut request = valid_request();
        request.dictionary.as_mut().unwrap().attribute_table[0] =
            dictionary.attribute_table[0].clone();
        let request =
            ExportProfilesServiceRequest::decode(request.encode_to_vec().as_slice()).unwrap();
        validate(&request).unwrap();
    }

    #[test]
    fn attribute_sentinel_rejects_nonzero_keys_units_and_present_values() {
        for value in [
            Value::StringValue(String::new()),
            Value::BoolValue(false),
            Value::IntValue(0),
            Value::DoubleValue(0.0),
            Value::ArrayValue(ArrayValue::default()),
            Value::KvlistValue(KeyValueList::default()),
            Value::BytesValue(vec![]),
            Value::StringValueStrindex(0),
        ] {
            let mut request = valid_request();
            request.dictionary.as_mut().unwrap().attribute_table[0].value =
                Some(AnyValue { value: Some(value) });
            assert_eq!(
                validate(&request).unwrap_err(),
                "dictionary.attribute_table[0] must be the zero value"
            );
        }
        for attribute in [
            KeyValueAndUnit {
                key_strindex: 1,
                value: Some(AnyValue::default()),
                ..Default::default()
            },
            KeyValueAndUnit {
                unit_strindex: 1,
                value: Some(AnyValue::default()),
                ..Default::default()
            },
        ] {
            let mut request = valid_request();
            request.dictionary.as_mut().unwrap().attribute_table[0] = attribute;
            assert_eq!(
                validate(&request).unwrap_err(),
                "dictionary.attribute_table[0] must be the zero value"
            );
        }
    }

    #[test]
    fn valid_dictionary_preserves_sample_weight() {
        let request = valid_request();
        validate(&request).unwrap();
        let profile = &request.resource_profiles[0].scope_profiles[0].profiles[0];
        assert_eq!(profile.samples[0].values, [17_080_000_000]);
    }

    #[test]
    fn collector_style_zero_based_dictionary_is_rejected_in_both_encodings() {
        let mut request = valid_request();
        let dictionary = request.dictionary.as_mut().unwrap();
        dictionary.stack_table.remove(0);
        dictionary.stack_table[0].location_indices = vec![0];
        request.resource_profiles[0].scope_profiles[0].profiles[0].samples[0].stack_index = 0;
        let proto =
            ExportProfilesServiceRequest::decode(request.encode_to_vec().as_slice()).unwrap();
        let mut json = serde_json::to_value(&request).unwrap();
        super::super::otlp_json_compat::normalize(&mut json);
        let json = super::super::otlp_json_compat::deserialize(json).unwrap();
        for request in [proto, json] {
            assert_eq!(
                validate(&request).unwrap_err(),
                "dictionary.stack_table[0] must be the zero value"
            );
        }
    }

    #[test]
    fn json_string_indices_survive_normalization_for_common_validation() {
        for index in [-1, 99] {
            for value in [
                serde_json::json!(index),
                serde_json::json!(index.to_string()),
            ] {
                let mut json = serde_json::json!({
                    "dictionary": {
                        "stringTable": ["", "thread.name"],
                        "attributeTable": [{}, {"keyStrindex": 1, "value": {"stringValueStrindex": value}}]
                    },
                    "resourceProfiles": [{"scopeProfiles": [{"profiles": [{"samples": [{"attributeIndices": [1], "values": [1]}]}]}]}]
                });
                super::super::otlp_json_compat::normalize(&mut json);
                let request = super::super::otlp_json_compat::deserialize(json).unwrap();
                let error = validate(&request).unwrap_err();
                assert!(
                    error.contains(&format!(
                        "dictionary.attribute_table[1].value.string_value_strindex: index {index}"
                    )),
                    "{error}"
                );
            }
        }
    }

    #[test]
    fn every_populated_table_requires_its_zero_entry() {
        let mutations: [fn(&mut ProfilesDictionary); 7] = [
            |d| d.mapping_table[0].memory_start = 1,
            |d| d.location_table[0].address = 1,
            |d| d.function_table[0].start_line = 1,
            |d| d.link_table[0].trace_id = vec![1],
            |d| d.string_table[0] = "cpu".into(),
            |d| d.attribute_table[0].key_strindex = 1,
            |d| d.stack_table[0].location_indices = vec![0],
        ];
        let names = [
            "mapping_table",
            "location_table",
            "function_table",
            "link_table",
            "string_table",
            "attribute_table",
            "stack_table",
        ];
        for (mutate, name) in mutations.iter().zip(names) {
            let mut request = valid_request();
            mutate(request.dictionary.as_mut().unwrap());
            assert_eq!(
                validate(&request).unwrap_err(),
                format!("dictionary.{name}[0] must be the zero value")
            );
        }
    }

    #[test]
    fn negative_and_out_of_bounds_references_identify_the_field() {
        let mutations: [DictionaryMutation; 12] = [
            (
                |d, v| d.mapping_table[1].filename_strindex = v,
                "mapping_table[1].filename_strindex",
            ),
            (
                |d, v| d.mapping_table[1].attribute_indices = vec![v],
                "mapping_table[1].attribute_indices[0]",
            ),
            (
                |d, v| d.location_table[1].mapping_index = v,
                "location_table[1].mapping_index",
            ),
            (
                |d, v| d.location_table[1].attribute_indices = vec![v],
                "location_table[1].attribute_indices[0]",
            ),
            (
                |d, v| d.location_table[1].lines[0].function_index = v,
                "location_table[1].lines[0].function_index",
            ),
            (
                |d, v| d.function_table[1].name_strindex = v,
                "function_table[1].name_strindex",
            ),
            (
                |d, v| d.function_table[1].system_name_strindex = v,
                "function_table[1].system_name_strindex",
            ),
            (
                |d, v| d.function_table[1].filename_strindex = v,
                "function_table[1].filename_strindex",
            ),
            (
                |d, v| d.attribute_table[1].key_strindex = v,
                "attribute_table[1].key_strindex",
            ),
            (
                |d, v| d.attribute_table[1].unit_strindex = v,
                "attribute_table[1].unit_strindex",
            ),
            (
                |d, v| d.attribute_table[1].value = Some(string_index(v)),
                "attribute_table[1].value.string_value_strindex",
            ),
            (
                |d, v| d.stack_table[1].location_indices = vec![v],
                "stack_table[1].location_indices[0]",
            ),
        ];
        for (mutate, field) in mutations {
            for value in [-1, 99] {
                let mut request = valid_request();
                mutate(request.dictionary.as_mut().unwrap(), value);
                let error = validate(&request).unwrap_err();
                assert!(
                    error.starts_with(&format!("dictionary.{field}: index {value}")),
                    "{error}"
                );
            }
        }
    }

    #[test]
    fn profile_references_are_validated_without_a_dictionary() {
        let mutations: [ProfileMutation; 8] = [
            (
                |p, v| p.samples[0].stack_index = v,
                "samples[0].stack_index",
            ),
            (|p, v| p.samples[0].link_index = v, "samples[0].link_index"),
            (
                |p, v| p.samples[0].attribute_indices = vec![v],
                "samples[0].attribute_indices[0]",
            ),
            (|p, v| p.attribute_indices = vec![v], "attribute_indices[0]"),
            (
                |p, v| {
                    p.sample_type = Some(ValueType {
                        type_strindex: v,
                        unit_strindex: 0,
                    })
                },
                "sample_type.type_strindex",
            ),
            (
                |p, v| {
                    p.sample_type = Some(ValueType {
                        type_strindex: 0,
                        unit_strindex: v,
                    })
                },
                "sample_type.unit_strindex",
            ),
            (
                |p, v| {
                    p.period_type = Some(ValueType {
                        type_strindex: v,
                        unit_strindex: 0,
                    })
                },
                "period_type.type_strindex",
            ),
            (
                |p, v| {
                    p.period_type = Some(ValueType {
                        type_strindex: 0,
                        unit_strindex: v,
                    })
                },
                "period_type.unit_strindex",
            ),
        ];
        for (mutate, field) in mutations {
            for value in [-1, 1] {
                let mut request = request_with(Profile {
                    samples: vec![Sample::default()],
                    ..Default::default()
                });
                mutate(
                    &mut request.resource_profiles[0].scope_profiles[0].profiles[0],
                    value,
                );
                let error = validate(&request).unwrap_err();
                assert!(
                    error.contains(&format!("{field}: index {value}")),
                    "{error}"
                );
            }
        }
    }

    #[test]
    fn resource_scope_and_nested_attribute_string_indices_are_validated() {
        let nested = AnyValue {
            value: Some(Value::ArrayValue(ArrayValue {
                values: vec![AnyValue {
                    value: Some(Value::KvlistValue(KeyValueList {
                        values: vec![KeyValue {
                            value: Some(string_index(-1)),
                            ..Default::default()
                        }],
                    })),
                }],
            })),
        };
        let mut request = valid_request();
        request.resource_profiles[0].resource =
            Some(opentelemetry_proto::tonic::resource::v1::Resource {
                attributes: vec![KeyValue {
                    value: Some(nested),
                    ..Default::default()
                }],
                ..Default::default()
            });
        let error = validate(&request).unwrap_err();
        assert!(error.contains("resource.attributes[0].value.array_value.values[0].kvlist_value.values[0].value.string_value_strindex: index -1"));
        request.resource_profiles[0].resource = None;
        request.resource_profiles[0].scope_profiles[0].scope = Some(
            opentelemetry_proto::tonic::common::v1::InstrumentationScope {
                attributes: vec![KeyValue {
                    key_strindex: 99,
                    ..Default::default()
                }],
                ..Default::default()
            },
        );
        assert!(
            validate(&request)
                .unwrap_err()
                .contains("scope.attributes[0].key_strindex: index 99")
        );
    }

    #[test]
    fn empty_exports_optional_tables_opaque_payloads_and_zero_references_are_accepted() {
        validate(&ExportProfilesServiceRequest::default()).unwrap();
        let mut request = request_with(Profile {
            original_payload_format: "pprof".into(),
            original_payload: vec![1, 2, 3],
            ..Default::default()
        });
        validate(&request).unwrap();
        request.dictionary = Some(ProfilesDictionary::default());
        validate(&request).unwrap();
        let profile = &mut request.resource_profiles[0].scope_profiles[0].profiles[0];
        profile.samples = vec![Sample {
            attribute_indices: vec![0],
            values: vec![1],
            ..Default::default()
        }];
        profile.attribute_indices = vec![0];
        profile.sample_type = Some(ValueType::default());
        profile.period_type = Some(ValueType::default());
        validate(&request).unwrap();
        request.dictionary = Some(ProfilesDictionary {
            string_table: vec!["".into(), "cpu".into()],
            ..Default::default()
        });
        validate(&request).unwrap();
    }

    fn string_index(value: i32) -> AnyValue {
        AnyValue {
            value: Some(Value::StringValueStrindex(value)),
        }
    }

    fn request_with(profile: Profile) -> ExportProfilesServiceRequest {
        ExportProfilesServiceRequest {
            resource_profiles: vec![ResourceProfiles {
                scope_profiles: vec![ScopeProfiles {
                    profiles: vec![profile],
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn valid_request() -> ExportProfilesServiceRequest {
        let mut request = request_with(Profile {
            sample_type: Some(ValueType {
                type_strindex: 1,
                unit_strindex: 2,
            }),
            samples: vec![Sample {
                stack_index: 1,
                values: vec![17_080_000_000],
                ..Default::default()
            }],
            ..Default::default()
        });
        request.dictionary = Some(ProfilesDictionary {
            mapping_table: vec![
                Mapping::default(),
                Mapping {
                    filename_strindex: 3,
                    ..Default::default()
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    mapping_index: 1,
                    lines: vec![Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 3,
                    ..Default::default()
                },
            ],
            link_table: vec![Link::default()],
            string_table: vec![
                "".into(),
                "cpu".into(),
                "nanoseconds".into(),
                "main.countDuplicatePairsQuadratic".into(),
            ],
            attribute_table: vec![
                KeyValueAndUnit::default(),
                KeyValueAndUnit {
                    key_strindex: 1,
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
        });
        request
    }
}
