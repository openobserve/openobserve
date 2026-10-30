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

/// 100 nested messages is prost's limit and the cap counts the root walk, so we bail no sooner.
const MAX_DEPTH: u32 = 101;
const REPLACEMENT: u8 = b'?';
const MAX_VARINT_BYTES: usize = 10;

#[derive(Clone, Copy)]
enum Msg {
    ExportLogsServiceRequest,
    ResourceLogs,
    Resource,
    EntityRef,
    ScopeLogs,
    InstrumentationScope,
    LogRecord,
    KeyValue,
    AnyValue,
    ArrayValue,
    KeyValueList,
}

impl Msg {
    /// Unlisted numbers are skipped by wire type, keeping `bytes` and future OTLP fields untouched.
    fn field(self, number: u64) -> Field {
        match self {
            Self::ExportLogsServiceRequest => match number {
                1 => Field::Message(Msg::ResourceLogs),
                _ => Field::Skip,
            },
            Self::ResourceLogs => match number {
                1 => Field::Message(Msg::Resource),
                2 => Field::Message(Msg::ScopeLogs),
                3 => Field::Utf8,
                _ => Field::Skip,
            },
            Self::Resource => match number {
                1 => Field::Message(Msg::KeyValue),
                3 => Field::Message(Msg::EntityRef),
                _ => Field::Skip,
            },
            Self::EntityRef => match number {
                1..=4 => Field::Utf8,
                _ => Field::Skip,
            },
            Self::ScopeLogs => match number {
                1 => Field::Message(Msg::InstrumentationScope),
                2 => Field::Message(Msg::LogRecord),
                3 => Field::Utf8,
                _ => Field::Skip,
            },
            Self::InstrumentationScope => match number {
                1 | 2 => Field::Utf8,
                3 => Field::Message(Msg::KeyValue),
                _ => Field::Skip,
            },
            Self::LogRecord => match number {
                3 | 12 => Field::Utf8,
                5 => Field::Message(Msg::AnyValue),
                6 => Field::Message(Msg::KeyValue),
                _ => Field::Skip,
            },
            Self::KeyValue => match number {
                1 => Field::Utf8,
                2 => Field::Message(Msg::AnyValue),
                _ => Field::Skip,
            },
            Self::AnyValue => match number {
                1 => Field::Utf8,
                5 => Field::Message(Msg::ArrayValue),
                6 => Field::Message(Msg::KeyValueList),
                _ => Field::Skip,
            },
            Self::ArrayValue => match number {
                1 => Field::Message(Msg::AnyValue),
                _ => Field::Skip,
            },
            Self::KeyValueList => match number {
                1 => Field::Message(Msg::KeyValue),
                _ => Field::Skip,
            },
        }
    }
}

#[derive(Clone, Copy)]
enum Field {
    Skip,
    Utf8,
    Message(Msg),
}

/// Valid only on a completed walk: 0 means discard the scratch copy rather than re-decode it.
pub(crate) fn sanitize_invalid_utf8(buf: &mut [u8]) -> usize {
    let mut replaced = 0;
    if walk(buf, Msg::ExportLogsServiceRequest, MAX_DEPTH, &mut replaced) {
        replaced
    } else {
        0
    }
}

/// Returns false when the walk cannot continue; the buffer may already be partially rewritten.
fn walk(buf: &mut [u8], msg: Msg, depth: u32, replaced: &mut usize) -> bool {
    if depth == 0 {
        return false;
    }
    let mut pos = 0;
    while pos < buf.len() {
        let Some((key, after_key)) = read_varint(buf, pos) else {
            return false;
        };
        let number = key >> 3;
        let wire = key & 7;
        pos = after_key;
        match wire {
            0 => match read_varint(buf, pos) {
                Some((_, after)) => pos = after,
                None => return false,
            },
            1 => match skip_fixed(buf, pos, 8) {
                Some(after) => pos = after,
                None => return false,
            },
            5 => match skip_fixed(buf, pos, 4) {
                Some(after) => pos = after,
                None => return false,
            },
            2 => match read_len_delimited(buf, pos) {
                Some((start, end)) => {
                    match msg.field(number) {
                        Field::Utf8 => *replaced += replace_invalid_utf8(&mut buf[start..end]),
                        Field::Message(nested) => {
                            if !walk(&mut buf[start..end], nested, depth - 1, replaced) {
                                return false;
                            }
                        }
                        Field::Skip => {}
                    }
                    pos = end;
                }
                None => return false,
            },
            _ => return false,
        }
    }
    true
}

fn read_varint(buf: &[u8], pos: usize) -> Option<(u64, usize)> {
    let mut value = 0u64;
    let mut shift = 0;
    for offset in 0..MAX_VARINT_BYTES {
        let byte = *buf.get(pos + offset)?;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            // prost rejects a tenth byte of 0x02 or more as a 64-bit overflow
            if offset == MAX_VARINT_BYTES - 1 && byte >= 0x02 {
                return None;
            }
            return Some((value, pos + offset + 1));
        }
        shift += 7;
    }
    None
}

fn skip_fixed(buf: &[u8], pos: usize, width: usize) -> Option<usize> {
    let end = pos.checked_add(width)?;
    (end <= buf.len()).then_some(end)
}

fn read_len_delimited(buf: &[u8], pos: usize) -> Option<(usize, usize)> {
    let (len, start) = read_varint(buf, pos)?;
    let end = start.checked_add(usize::try_from(len).ok()?)?;
    (end <= buf.len()).then_some((start, end))
}

fn replace_invalid_utf8(buf: &mut [u8]) -> usize {
    let mut replaced = 0;
    let mut offset = 0;
    while offset < buf.len() {
        let Err(err) = std::str::from_utf8(&buf[offset..]) else {
            break;
        };
        let start = offset + err.valid_up_to();
        let len = err.error_len().unwrap_or(buf.len() - start);
        for byte in &mut buf[start..start + len] {
            *byte = REPLACEMENT;
        }
        replaced += len;
        offset = start + len;
    }
    replaced
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::{
        collector::logs::v1::ExportLogsServiceRequest,
        common::v1::{AnyValue, any_value::Value},
    };
    use prost::Message;

    use super::*;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return out;
            }
            out.push(byte | 0x80);
        }
    }

    fn key(number: u64, wire: u64) -> Vec<u8> {
        varint((number << 3) | wire)
    }

    fn delimited(number: u64, payload: &[u8]) -> Vec<u8> {
        let mut out = key(number, 2);
        out.extend(varint(payload.len() as u64));
        out.extend_from_slice(payload);
        out
    }

    fn varint_field(number: u64, value: u64) -> Vec<u8> {
        let mut out = key(number, 0);
        out.extend(varint(value));
        out
    }

    fn concat(parts: &[&[u8]]) -> Vec<u8> {
        parts.concat()
    }

    fn export_request(resource_logs: &[u8]) -> Vec<u8> {
        delimited(1, resource_logs)
    }

    fn scope_logs_only(scope_logs: &[u8]) -> Vec<u8> {
        export_request(&delimited(2, scope_logs))
    }

    fn log_record_only(log_record: &[u8]) -> Vec<u8> {
        scope_logs_only(&delimited(2, log_record))
    }

    fn body_value(any_value: &[u8]) -> Vec<u8> {
        log_record_only(&delimited(5, any_value))
    }

    fn string_any_value(text: &[u8]) -> Vec<u8> {
        delimited(1, text)
    }

    /// One extra level alone is not expressible: an `ArrayValue` can only hold an `AnyValue`.
    fn nested_any_value(extra_levels: usize, text: &[u8]) -> Vec<u8> {
        assert_ne!(extra_levels, 1, "one extra level is not expressible");
        let mut nested = string_any_value(text);
        let mut remaining = extra_levels;
        if remaining % 2 == 1 {
            nested = delimited(6, &delimited(1, &delimited(2, &nested)));
            remaining -= 3;
        }
        for _ in 0..remaining / 2 {
            nested = delimited(5, &delimited(1, &nested));
        }
        nested
    }

    fn deepest_nesting_prost_accepts() -> usize {
        let mut deepest = 0;
        for extra in (0..=256).filter(|extra| *extra != 1) {
            let payload = body_value(&nested_any_value(extra, b"deep"));
            if ExportLogsServiceRequest::decode(payload.as_slice()).is_err() {
                return deepest;
            }
            deepest = extra;
        }
        panic!("prost accepted every nesting depth tried");
    }

    fn decode(buf: &[u8]) -> ExportLogsServiceRequest {
        ExportLogsServiceRequest::decode(buf).expect("decodes after sanitizing")
    }

    fn first_body(req: &ExportLogsServiceRequest) -> AnyValue {
        req.resource_logs[0].scope_logs[0].log_records[0]
            .body
            .clone()
            .expect("body")
    }

    fn changed_bytes(before: &[u8], after: &[u8]) -> usize {
        assert_eq!(before.len(), after.len(), "sanitizing must preserve length");
        before
            .iter()
            .zip(after)
            .filter(|(before, after)| before != after)
            .count()
    }

    #[test]
    fn valid_payload_is_untouched() {
        let mut buf = body_value(&string_any_value(b"hello \xe2\x9c\x93"));
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 0);
        assert_eq!(buf, original);
    }

    #[test]
    fn invalid_body_string_is_replaced_and_decodes() {
        let mut buf = body_value(&string_any_value(b"caf\xe9 bar"));
        let original = buf.clone();
        assert!(ExportLogsServiceRequest::decode(original.as_slice()).is_err());
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        assert_eq!(changed_bytes(&original, &buf), 1);
        assert_eq!(buf.len(), original.len());
        let req = decode(&buf);
        assert_eq!(
            first_body(&req).value,
            Some(Value::StringValue("caf? bar".to_string()))
        );
    }

    #[test]
    fn invalid_attribute_key_and_value_are_replaced() {
        let key_value = concat(&[
            &delimited(1, b"k\xffey"),
            &delimited(2, &string_any_value(b"v\xffal")),
        ]);
        let mut buf = log_record_only(&delimited(6, &key_value));
        assert!(ExportLogsServiceRequest::decode(buf.as_slice()).is_err());
        assert_eq!(sanitize_invalid_utf8(&mut buf), 2);
        let req = decode(&buf);
        let attr = &req.resource_logs[0].scope_logs[0].log_records[0].attributes[0];
        assert_eq!(attr.key, "k?ey");
        assert_eq!(
            attr.value.as_ref().unwrap().value,
            Some(Value::StringValue("v?al".to_string()))
        );
    }

    #[test]
    fn invalid_strings_across_the_schema_are_replaced() {
        let scope_attribute = concat(&[
            &delimited(1, b"sk\xffey"),
            &delimited(2, &string_any_value(b"sv\xffal")),
        ]);
        let scope = concat(&[
            &delimited(1, b"na\xffme"),
            &delimited(2, b"ver\xffsion"),
            &delimited(3, &scope_attribute),
        ]);
        let log_record = delimited(3, b"WA\xffRN");
        let scope_logs = concat(&[
            &delimited(1, &scope),
            &delimited(2, &log_record),
            &delimited(3, b"scope\xffurl"),
        ]);
        let resource = delimited(1, &delimited(1, b"res\xffkey"));
        let resource_logs = concat(&[
            &delimited(1, &resource),
            &delimited(2, &scope_logs),
            &delimited(3, b"res\xffurl"),
        ]);
        let mut buf = export_request(&resource_logs);
        assert!(ExportLogsServiceRequest::decode(buf.as_slice()).is_err());
        assert_eq!(sanitize_invalid_utf8(&mut buf), 8);
        let req = decode(&buf);
        let resource_logs = &req.resource_logs[0];
        assert_eq!(resource_logs.schema_url, "res?url");
        assert_eq!(
            resource_logs.resource.as_ref().unwrap().attributes[0].key,
            "res?key"
        );
        let scope_logs = &resource_logs.scope_logs[0];
        assert_eq!(scope_logs.schema_url, "scope?url");
        let scope = scope_logs.scope.as_ref().unwrap();
        assert_eq!(scope.name, "na?me");
        assert_eq!(scope.version, "ver?sion");
        assert_eq!(scope.attributes[0].key, "sk?ey");
        assert_eq!(
            scope.attributes[0].value.as_ref().unwrap().value,
            Some(Value::StringValue("sv?al".to_string()))
        );
        assert_eq!(scope_logs.log_records[0].severity_text, "WA?RN");
    }

    #[test]
    fn entity_ref_strings_are_replaced() {
        let entity_ref = concat(&[
            &delimited(1, b"ent\xffurl"),
            &delimited(2, b"ho\xffst"),
            &delimited(3, b"id\xffone"),
            &delimited(3, b"id\xfftwo"),
            &delimited(4, b"de\xffsc"),
        ]);
        let mut buf = export_request(&delimited(1, &delimited(3, &entity_ref)));
        assert!(ExportLogsServiceRequest::decode(buf.as_slice()).is_err());
        assert_eq!(sanitize_invalid_utf8(&mut buf), 5);
        let req = decode(&buf);
        let entity_ref = &req.resource_logs[0].resource.as_ref().unwrap().entity_refs[0];
        assert_eq!(entity_ref.schema_url, "ent?url");
        assert_eq!(entity_ref.r#type, "ho?st");
        assert_eq!(entity_ref.id_keys, vec!["id?one", "id?two"]);
        assert_eq!(entity_ref.description_keys, vec!["de?sc"]);
    }

    #[test]
    fn nested_array_and_kvlist_values_are_replaced() {
        let array = delimited(5, &delimited(1, &string_any_value(b"arr\xffay")));
        let kvlist = delimited(
            6,
            &delimited(1, &delimited(2, &string_any_value(b"kv\xfflist"))),
        );
        let mut buf = body_value(&array);
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        match first_body(&decode(&buf)).value {
            Some(Value::ArrayValue(array)) => {
                assert_eq!(
                    array.values[0].value,
                    Some(Value::StringValue("arr?ay".to_string()))
                );
            }
            other => panic!("expected an array value, got {other:?}"),
        }
        let mut buf = body_value(&kvlist);
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        match first_body(&decode(&buf)).value {
            Some(Value::KvlistValue(list)) => {
                assert_eq!(
                    list.values[0].value.as_ref().unwrap().value,
                    Some(Value::StringValue("kv?list".to_string()))
                );
            }
            other => panic!("expected a kvlist value, got {other:?}"),
        }
    }

    #[test]
    fn trace_id_and_span_id_bytes_are_untouched() {
        let log_record = concat(&[
            &delimited(
                9,
                b"\xff\xfe\xfd\xfc\xfb\xfa\xf9\xf8\xf7\xf6\xf5\xf4\xf3\xf2\xf1\xf0",
            ),
            &delimited(10, b"\xff\xee\xdd\xcc\xbb\xaa\x99\x88"),
            &delimited(3, b"IN\xffFO"),
        ]);
        let mut buf = log_record_only(&log_record);
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        let req = decode(&buf);
        let record = &req.resource_logs[0].scope_logs[0].log_records[0];
        assert_eq!(
            record.trace_id,
            b"\xff\xfe\xfd\xfc\xfb\xfa\xf9\xf8\xf7\xf6\xf5\xf4\xf3\xf2\xf1\xf0"
        );
        assert_eq!(record.span_id, b"\xff\xee\xdd\xcc\xbb\xaa\x99\x88");
        assert_eq!(record.severity_text, "IN?FO");
    }

    #[test]
    fn bytes_value_is_untouched() {
        let mut buf = body_value(&delimited(7, b"\xff\x00\xfe binary"));
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 0);
        assert_eq!(buf, original);
        assert_eq!(
            first_body(&decode(&buf)).value,
            Some(Value::BytesValue(b"\xff\x00\xfe binary".to_vec()))
        );
    }

    #[test]
    fn unknown_field_numbers_are_skipped() {
        let log_record = concat(&[
            &delimited(200, b"\xff\xfe future"),
            &delimited(3, b"E\xffRR"),
        ]);
        let mut buf = log_record_only(&log_record);
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        assert_eq!(changed_bytes(&original, &buf), 1);
        let unknown = b"\xff\xfe future";
        assert!(buf.windows(unknown.len()).any(|window| window == unknown));
    }

    #[test]
    fn group_and_unknown_wire_types_abandon_the_walk() {
        let start_group = key(20, 3);
        let end_group = key(20, 4);
        let well_formed_group = concat(&[&start_group, &varint_field(1, 1), &end_group]);
        for tag in [well_formed_group, start_group, end_group, key(21, 6)] {
            let mut buf = log_record_only(&concat(&[&tag, &delimited(3, b"WA\xffRN")]));
            let original = buf.clone();
            assert_eq!(sanitize_invalid_utf8(&mut buf), 0);
            assert_eq!(buf, original);

            let mut buf = log_record_only(&concat(&[&delimited(3, b"WA\xffRN"), &tag]));
            assert_eq!(sanitize_invalid_utf8(&mut buf), 0);
            assert_eq!(
                buf,
                log_record_only(&concat(&[&delimited(3, b"WA?RN"), &tag]))
            );
        }
    }

    #[test]
    fn a_varint_that_overflows_sixty_four_bits_bails() {
        let overflowing_key = b"\x88\x80\x80\x80\x80\x80\x80\x80\x80\x02";
        let log_record = concat(&[overflowing_key, &varint(0), &delimited(3, b"WA\xffRN")]);
        let mut buf = log_record_only(&log_record);
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 0);
        assert_eq!(buf, original);
    }

    #[test]
    fn malformed_buffers_return_zero() {
        let full = body_value(&string_any_value(b"caf\xe9"));
        for cut in 1..full.len() {
            let mut truncated = full[..cut].to_vec();
            let replaced = sanitize_invalid_utf8(&mut truncated);
            assert_eq!(replaced, 0, "truncation at {cut} must bail");
        }
        let mut overrun = concat(&[&key(1, 2), &varint(4096), b"short"]);
        assert_eq!(sanitize_invalid_utf8(&mut overrun), 0);
        let mut truncated_varint = vec![0xff; 3];
        assert_eq!(sanitize_invalid_utf8(&mut truncated_varint), 0);
        let mut oversized_varint = vec![0xff; 12];
        assert_eq!(sanitize_invalid_utf8(&mut oversized_varint), 0);
        let mut fixed64_overrun = concat(&[&key(1, 1), b"\x00\x00"]);
        assert_eq!(sanitize_invalid_utf8(&mut fixed64_overrun), 0);
        let mut fixed32_overrun = concat(&[&key(1, 5), b"\x00"]);
        assert_eq!(sanitize_invalid_utf8(&mut fixed32_overrun), 0);
    }

    #[test]
    fn scalar_fields_are_stepped_over() {
        let log_record = concat(&[
            &concat(&[&key(1, 1), b"\x01\x02\x03\x04\x05\x06\x07\x08"]),
            &varint_field(2, 9),
            &concat(&[&key(8, 5), b"\x01\x02\x03\x04"]),
            &delimited(12, b"eve\xffnt"),
        ]);
        let mut buf = log_record_only(&log_record);
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        assert_eq!(changed_bytes(&original, &buf), 1);
        let req = decode(&buf);
        let record = &req.resource_logs[0].scope_logs[0].log_records[0];
        assert_eq!(record.time_unix_nano, 0x0807_0605_0403_0201);
        assert_eq!(record.severity_number, 9);
        assert_eq!(record.flags, 0x0403_0201);
        assert_eq!(record.event_name, "eve?nt");
    }

    #[test]
    fn the_deepest_nesting_prost_accepts_is_still_repaired() {
        let deepest = deepest_nesting_prost_accepts();
        let mut buf = body_value(&nested_any_value(deepest, b"deep\xff"));
        assert!(ExportLogsServiceRequest::decode(buf.as_slice()).is_err());
        assert_eq!(sanitize_invalid_utf8(&mut buf), 1);
        assert_eq!(decode(&buf).resource_logs.len(), 1);

        let mut buf = body_value(&nested_any_value(deepest + 1, b"deep\xff"));
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 0);
        assert_eq!(buf, original);
        assert!(ExportLogsServiceRequest::decode(buf.as_slice()).is_err());
    }

    #[test]
    fn multi_byte_runs_and_truncated_tails_are_counted() {
        let mut buf = body_value(&string_any_value(b"a\xf0\x9f\x98"));
        let original = buf.clone();
        assert_eq!(sanitize_invalid_utf8(&mut buf), 3);
        assert_eq!(changed_bytes(&original, &buf), 3);
        assert_eq!(
            first_body(&decode(&buf)).value,
            Some(Value::StringValue("a???".to_string()))
        );

        let mut buf = body_value(&string_any_value(b"\xff\xff x \xc3\x28"));
        let original = buf.clone();
        let replaced = sanitize_invalid_utf8(&mut buf);
        assert_eq!(replaced, changed_bytes(&original, &buf));
        assert_eq!(
            first_body(&decode(&buf)).value,
            Some(Value::StringValue("?? x ?(".to_string()))
        );
    }
}
