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

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use super::{
    ConsumerType, SecretErrorCode, derived_id,
    grammar::{RefKind, parse_refs},
    length_prefixed,
};

pub const EMPTY_DEP_LIST: &str = "[]";

const DESTINATION_EXCLUDED: &[&str] = &["/name", "/module/alert/template"];
const SYNTHETICS_EXCLUDED: &[&str] = &[
    "/name",
    "/description",
    "/tags",
    "/folder_id",
    "/frequency",
    "/tz_offset",
    "/enabled",
    "/destinations",
    "/template",
    "/retries",
    "/wait_before_retry_secs",
    "/alert_if_fails",
    "/cooldown_mins",
    "/start",
    "/next_run_at",
    "/last_triggered_at",
    "/last_check_status",
    "/last_run_class",
    "/last_run_class_at",
    "/confirm_failures",
    "/alert_on",
    "/owner",
    "/created_at",
    "/updated_at",
];
const AI_TOOLSET_EXCLUDED: &[&str] = &["/name", "/description"];

pub struct KAuth(Zeroizing<[u8; 32]>);

impl KAuth {
    pub fn derive(dek: &[u8]) -> Self {
        let mut key = Zeroizing::new([0; 32]);
        Hkdf::<Sha256>::new(None, dek)
            .expand(b"o2-auth/v1", key.as_mut())
            .expect("32 bytes fit in one HKDF-SHA256 output block");
        Self(key)
    }

    pub fn literal(&self, value: &str) -> String {
        let bytes = Zeroizing::new(length_prefixed(&[b"o2-lit/v1", value.as_bytes()]));
        let mut mac = self.mac();
        mac.update(&bytes);
        hex::encode(mac.finalize().into_bytes())
    }

    pub fn auth_tag(&self, input: &AuthTagInput<'_>) -> String {
        hex::encode(self.consumer_mac(input).finalize().into_bytes())
    }

    pub fn verify_auth_tag(&self, input: &AuthTagInput<'_>, tag_hex: &str) -> bool {
        let mut tag = [0; 32];
        hex::decode_to_slice(tag_hex, &mut tag).is_ok()
            && self.consumer_mac(input).verify_slice(&tag).is_ok()
    }

    fn mac(&self) -> Hmac<Sha256> {
        Hmac::new_from_slice(self.0.as_ref()).expect("HMAC accepts any key length")
    }

    fn consumer_mac(&self, input: &AuthTagInput<'_>) -> Hmac<Sha256> {
        let bindings: BTreeSet<_> = input
            .refs
            .iter()
            .map(|r| (&r.field, &r.secret_id))
            .collect();
        let refs: Vec<_> = bindings
            .into_iter()
            .map(|(field, secret_id)| json!({ "field": field, "secret_id": secret_id }))
            .collect();
        let refs =
            jcs(&Value::Array(refs)).expect("reference objects have fixed keys and string values");
        let deps = encode_dep_digests(input.dep_digests)
            .expect("dependency maps have unique string keys and string values");
        let mut mac = self.mac();
        mac.update(&length_prefixed(&[
            b"o2-consumer-auth/v1",
            input.org_id.as_bytes(),
            input.consumer_type.as_str().as_bytes(),
            input.consumer_id.as_bytes(),
            input.consumer_rev.to_string().as_bytes(),
            &refs,
            input.delivery_digest.as_bytes(),
            deps.as_bytes(),
        ]));
        mac
    }
}

impl fmt::Debug for KAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("KAuth(..)")
    }
}

pub struct AuthTagInput<'a> {
    pub org_id: &'a str,
    pub consumer_type: ConsumerType,
    pub consumer_id: &'a str,
    pub consumer_rev: i64,
    pub refs: &'a [BoundRef],
    pub delivery_digest: &'a str,
    pub dep_digests: &'a DepDigests,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BoundRef {
    pub field: String,
    pub token_name: String,
    pub secret_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DepEntry {
    Store {
        secret_id: String,
        value_rev: String,
    },
    StoreMissing {
        secret_id: String,
    },
    Legacy {
        name: String,
        rev: String,
        vh: String,
    },
    Local {
        name: String,
    },
    Absent {
        name: String,
    },
}

impl DepEntry {
    pub fn to_json(&self) -> Value {
        match self {
            Self::Store {
                secret_id,
                value_rev,
            } => json!({ "vars": secret_id, "value_rev": value_rev }),
            Self::StoreMissing { secret_id } => json!({ "vars": secret_id, "missing": true }),
            Self::Legacy { name, rev, vh } => json!({ "name": name, "rev": rev, "vh": vh }),
            Self::Local { name } => json!({ "name": name, "local": true }),
            Self::Absent { name } => json!({ "name": name, "absent": true }),
        }
    }

    pub fn legacy(
        k_auth: &KAuth,
        name: &str,
        legacy_id: &str,
        updated_at: i64,
        value: &str,
    ) -> Self {
        Self::Legacy {
            name: name.to_owned(),
            rev: legacy_rev(legacy_id, updated_at),
            vh: k_auth.literal(value),
        }
    }
}

pub type DepDigests = BTreeMap<String, String>;

pub fn empty_dep_digest() -> String {
    sha256_hex(EMPTY_DEP_LIST.as_bytes())
}

pub fn jcs(value: &Value) -> Result<Vec<u8>, SecretErrorCode> {
    serde_json_canonicalizer::to_vec(value).map_err(|_| SecretErrorCode::SecretUnavailable)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn excluded_pointers(consumer: ConsumerType) -> &'static [&'static str] {
    match consumer {
        ConsumerType::AlertDestination | ConsumerType::PipelineDestination => DESTINATION_EXCLUDED,
        ConsumerType::SyntheticsCheck => SYNTHETICS_EXCLUDED,
        ConsumerType::AiToolset => AI_TOOLSET_EXCLUDED,
    }
}

pub fn projection(
    consumer: ConsumerType,
    stored: &Value,
    keyed_pointers: &[String],
    k_auth: &KAuth,
    secret_id_for: impl Fn(&str, &str) -> Option<String>,
) -> Result<Value, SecretErrorCode> {
    let mut projected = stored.clone();
    for pointer in excluded_pointers(consumer) {
        let (parent, key) = pointer
            .rsplit_once('/')
            .expect("excluded pointers address object fields");
        if let Some(Value::Object(object)) = projected.pointer_mut(parent) {
            object.remove(key);
        }
    }
    for pointer in keyed_pointers {
        if let Some(Value::String(value)) = projected.pointer_mut(pointer)
            && let Some(Value::String(literal)) = stored.pointer(pointer)
        {
            value.zeroize();
            *value = k_auth.literal(literal);
        }
    }
    rewrite_refs(&mut projected, "", &secret_id_for)?;
    Ok(projected)
}

pub fn delivery_digest(
    consumer: ConsumerType,
    stored: &Value,
    keyed_pointers: &[String],
    k_auth: &KAuth,
    secret_id_for: impl Fn(&str, &str) -> Option<String>,
) -> Result<String, SecretErrorCode> {
    let projected = projection(consumer, stored, keyed_pointers, k_auth, secret_id_for)?;
    Ok(sha256_hex(&jcs(&projected)?))
}

pub fn legacy_rev(legacy_id: &str, updated_at: i64) -> String {
    derived_id(&[legacy_id.as_bytes(), updated_at.to_string().as_bytes()])
}

pub fn dep_digest(entries: &[DepEntry]) -> Result<String, SecretErrorCode> {
    let entries = entries
        .iter()
        .map(|entry| jcs(&entry.to_json()))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let mut hash = Sha256::new();
    hash.update(b"[");
    for (i, entry) in entries.into_iter().enumerate() {
        if i != 0 {
            hash.update(b",");
        }
        hash.update(entry);
    }
    hash.update(b"]");
    Ok(hex::encode(hash.finalize()))
}

pub fn dep_digests(
    entries_by_env: &BTreeMap<String, Vec<DepEntry>>,
) -> Result<DepDigests, SecretErrorCode> {
    if entries_by_env.is_empty() {
        return Err(SecretErrorCode::DeliveryStale);
    }
    entries_by_env
        .iter()
        .map(|(env, entries)| Ok((env.clone(), dep_digest(entries)?)))
        .collect()
}

pub fn encode_dep_digests(d: &DepDigests) -> Result<String, SecretErrorCode> {
    serde_json_canonicalizer::to_string(d).map_err(|_| SecretErrorCode::SecretUnavailable)
}

pub fn decode_dep_digests(text: &str) -> Result<DepDigests, SecretErrorCode> {
    serde_json::from_str(text).map_err(|_| SecretErrorCode::DeliveryStale)
}

pub fn dep_digest_matches(stored: &DepDigests, env: &str, computed: &str) -> bool {
    stored.get(env).is_some_and(|digest| digest == computed)
}

fn rewrite_refs(
    value: &mut Value,
    pointer: &str,
    secret_id_for: &impl Fn(&str, &str) -> Option<String>,
) -> Result<(), SecretErrorCode> {
    match value {
        Value::String(text) => {
            let mut rewritten = String::new();
            let mut end = 0;
            for token in parse_refs(text)? {
                if token.kind == RefKind::Secret {
                    let id = secret_id_for(pointer, &token.name)
                        .ok_or(SecretErrorCode::SecretUnbound)?;
                    rewritten.push_str(&text[end..token.start]);
                    rewritten.push_str("{{secrets#");
                    rewritten.push_str(&id);
                    rewritten.push_str("}}");
                    end = token.end;
                }
            }
            if end != 0 {
                rewritten.push_str(&text[end..]);
                *text = rewritten;
            }
        }
        Value::Object(object) => {
            for (key, child) in object {
                let key = key.replace('~', "~0").replace('/', "~1");
                rewrite_refs(child, &format!("{pointer}/{key}"), secret_id_for)?;
            }
        }
        Value::Array(array) => {
            for (index, child) in array.iter_mut().enumerate() {
                rewrite_refs(child, &format!("{pointer}/{index}"), secret_id_for)?;
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::{Value, json};

    use super::*;
    use crate::meta::{
        destinations::{Destination, DestinationType, Endpoint, Module},
        secret_store::ORG_ENV_ID,
        synthetics::{AlertOn, Synthetic, SyntheticAuth, SyntheticFrequency},
    };

    const EMPTY_DIGEST: &str = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
    const SYNTHETICS_DIGESTED: &[&str] = &[
        "/id",
        "/org_id",
        "/type",
        "/target",
        "/config",
        "/locations",
        "/auth",
        "/cookies",
        "/variables",
        "/environments",
        "/collect_rum_data",
        "/session_replay",
    ];

    #[test]
    fn jcs_encodes_arbitrary_precision_numbers_as_json_numbers() {
        let value = json!({"b": 1, "a": [true, null, 1.5, 1700000000000000i64]});
        assert_eq!(
            jcs(&value).unwrap(),
            br#"{"a":[true,null,1.5,1700000000000000],"b":1}"#
        );
        let out_of_range: Value = serde_json::from_str("1e999").unwrap();
        assert_eq!(jcs(&out_of_range), Err(SecretErrorCode::SecretUnavailable));
    }

    #[test]
    fn empty_dependency_lists_are_pinned_for_each_environment() {
        assert_eq!(empty_dep_digest(), EMPTY_DIGEST);
        for environments in [vec![ORG_ENV_ID], vec!["prod", "staging"]] {
            let entries = environments
                .iter()
                .map(|env| (env.to_string(), vec![]))
                .collect();
            let digests = dep_digests(&entries).unwrap();
            let expected: DepDigests = environments
                .iter()
                .map(|env| (env.to_string(), EMPTY_DIGEST.into()))
                .collect();
            assert_eq!(digests, expected);
            assert_eq!(
                decode_dep_digests(&encode_dep_digests(&digests).unwrap()).unwrap(),
                digests
            );
            let missing = decode_dep_digests("{}").unwrap();
            for env in environments {
                assert!(dep_digest_matches(&digests, env, EMPTY_DIGEST));
                assert!(!dep_digest_matches(&missing, env, EMPTY_DIGEST));
                assert!(!dep_digest_matches(&digests, env, "different"));
            }
        }
        assert_eq!(
            dep_digests(&BTreeMap::new()),
            Err(SecretErrorCode::DeliveryStale)
        );
        for malformed in ["{", "[]", r#"{"prod":1}"#] {
            assert_eq!(
                decode_dep_digests(malformed),
                Err(SecretErrorCode::DeliveryStale)
            );
        }
    }

    #[test]
    fn destination_digest_tracks_delivery_fields_and_stable_secret_ids() {
        let consumer = ConsumerType::AlertDestination;
        let key = KAuth::derive(&[7; 64]);
        let stored = json!({"id": "dst", "org_id": "org", "name": "old",
            "module": {"alert": {"template": "t", "destination_type": {
                "type": "http", "url": "https://example.org", "skip_tls_verify": false,
                "headers": {"Authorization": "{{secrets.OLD}}", "X-Route": "blue"}
            }}}
        });
        let bind = |_: &str, name: &str| matches!(name, "OLD" | "NEW").then(|| "id_1".to_owned());
        let digest = |value: &Value| delivery_digest(consumer, value, &[], &key, bind).unwrap();
        let original = digest(&stored);
        let deps = dep_digests(&BTreeMap::from([(ORG_ENV_ID.to_owned(), vec![])])).unwrap();
        let refs = [BoundRef {
            field: "/module/alert/destination_type/headers/Authorization".into(),
            token_name: "OLD".into(),
            secret_id: "id_1".into(),
        }];
        let input = AuthTagInput {
            org_id: "org",
            consumer_type: consumer,
            consumer_id: "dst",
            consumer_rev: 1,
            refs: &refs,
            delivery_digest: &original,
            dep_digests: &deps,
        };
        assert_eq!(
            encode_dep_digests(&deps).unwrap(),
            format!(r#"{{"_org":"{EMPTY_DIGEST}"}}"#)
        );
        let tag = key.auth_tag(&input);
        assert!(!key.verify_auth_tag(
            &AuthTagInput {
                dep_digests: &DepDigests::new(),
                ..input
            },
            &tag
        ));
        let project = projection(consumer, &stored, &[], &key, bind).unwrap();
        assert!(!project.to_string().contains("{{secrets."));
        assert_eq!(
            project.pointer("/module/alert/destination_type/headers/Authorization"),
            Some(&json!("{{secrets#id_1}}"))
        );
        for (path, value, unchanged) in [
            (
                "/module/alert/destination_type/headers/Authorization",
                json!("{{secrets.NEW}}"),
                true,
            ),
            ("/name", json!("new"), true),
            ("/module/alert/template", json!("another"), true),
            (
                "/module/alert/destination_type/url",
                json!("https://other.example.org"),
                false,
            ),
            (
                "/module/alert/destination_type/headers/X-Route",
                json!("green"),
                false,
            ),
            (
                "/module/alert/destination_type/skip_tls_verify",
                json!(true),
                false,
            ),
        ] {
            let mut changed = stored.clone();
            *changed.pointer_mut(path).unwrap() = value;
            assert_eq!(digest(&changed) == original, unchanged, "{path}");
        }
        assert_ne!(
            delivery_digest(consumer, &stored, &[], &key, |_, _| Some("id_2".into())).unwrap(),
            original
        );
        assert_eq!(
            delivery_digest(consumer, &stored, &[], &key, |_, _| None),
            Err(SecretErrorCode::SecretUnbound)
        );
    }

    #[test]
    fn projection_preserves_variables_and_keys_and_escapes_array_element_pointers() {
        let key = KAuth::derive(&[7; 64]);
        let stored = json!({"name":"{{Secrets.IGNORED}}", "description":"info", "a~/b": [
            {"{{secrets.KEY}}":"é {{secrets.A}}{{vars.B}}{{secrets.C}} end"}
        ]});
        let result = projection(ConsumerType::AiToolset, &stored, &[], &key, |path, name| {
            assert_eq!(path, "/a~0~1b/0/{{secrets.KEY}}");
            Some(format!("id_{name}"))
        })
        .unwrap();
        assert_eq!(
            result,
            json!({"a~/b":[{"{{secrets.KEY}}":"é {{secrets#id_A}}{{vars.B}}{{secrets#id_C}} end"}]})
        );
        assert_eq!(
            projection(
                ConsumerType::AiToolset,
                &json!(["{{Vars.B}}"]),
                &[],
                &key,
                |_, _| None
            ),
            Err(SecretErrorCode::RefTypo)
        );
    }

    #[test]
    fn keyed_literals_are_hashed_before_refs_are_parsed() {
        let key = KAuth::derive(&[7; 64]);
        let other = KAuth::derive(&[8; 64]);
        assert_eq!(format!("{key:?}"), "KAuth(..)");
        let stored = json!({"password":"hunter2","token":"{{secrets.X}}","count":1});
        let keyed = ["/password", "/token", "/count", "/missing"].map(String::from);
        let project = |key: &KAuth| {
            projection(ConsumerType::AiToolset, &stored, &keyed, key, |_, _| None).unwrap()
        };
        let mut projected = project(&key);
        assert_eq!(
            projected,
            json!({"password":key.literal("hunter2"), "token":key.literal("{{secrets.X}}"), "count":1})
        );
        let digest = |v: &Value| sha256_hex(&jcs(v).unwrap());
        let pinned =
            delivery_digest(ConsumerType::AiToolset, &stored, &keyed, &key, |_, _| None).unwrap();
        assert_eq!(digest(&projected), pinned);
        assert_ne!(digest(&project(&other)), pinned);
        let candidate = sha256_hex(b"hunter2");
        assert_ne!(candidate, pinned);
        for guess in [json!("hunter2"), json!(candidate)] {
            projected["password"] = guess;
            assert_ne!(digest(&projected), pinned);
        }
    }

    fn assert_partition(value: &Value, parent: &str, digested: &[&str], excluded: &[&str]) {
        let object = value.pointer(parent).unwrap().as_object().unwrap();
        let actual: BTreeSet<_> = object.keys().map(|key| format!("{parent}/{key}")).collect();
        let expected: Vec<_> = digested
            .iter()
            .chain(excluded)
            .copied()
            .filter(|path| path.rsplit_once('/').unwrap().0 == parent)
            .collect();
        let unique: BTreeSet<_> = expected.iter().map(|path| path.to_string()).collect();
        assert_eq!(unique.len(), expected.len(), "duplicate field at {parent}");
        assert_eq!(actual, unique);
    }

    #[test]
    fn every_serialized_destination_field_is_classified() {
        let endpoint = Endpoint::default();
        let alert = Module::Alert {
            template: Some("template".into()),
            destination_type: DestinationType::Http(endpoint.clone()),
        };
        let pipeline = Module::Pipeline { endpoint };
        assert_eq!(DESTINATION_EXCLUDED, &["/name", "/module/alert/template"]);
        for (consumer, module, parent, digested) in [
            (
                ConsumerType::AlertDestination,
                alert,
                "/module/alert",
                "/module/alert/destination_type",
            ),
            (
                ConsumerType::PipelineDestination,
                pipeline,
                "/module/pipeline",
                "/module/pipeline/endpoint",
            ),
        ] {
            let value = serde_json::to_value(Destination {
                id: None,
                org_id: "org".into(),
                name: "test".into(),
                module,
            })
            .unwrap();
            let excluded = excluded_pointers(consumer);
            assert_partition(&value, "", &["/id", "/org_id", "/module"], excluded);
            assert_partition(&value, "/module", &[parent], excluded);
            assert_partition(&value, parent, &[digested], excluded);
        }
    }

    #[test]
    fn every_serialized_synthetic_field_is_classified() {
        let check = Synthetic {
            id: "id".into(),
            org_id: "org".into(),
            folder_id: "f".into(),
            tz_offset: 0,
            name: "check".into(),
            description: "desc".into(),
            tags: vec!["tag".into()],
            check_type: Default::default(),
            target: "https://example.org".into(),
            config: json!({}),
            frequency: SyntheticFrequency {
                timezone: Some("UTC".into()),
                ..Default::default()
            },
            locations: vec!["loc".into()],
            enabled: true,
            destinations: vec!["dst".into()],
            template: Some("template".into()),
            retries: 1,
            wait_before_retry_secs: 5,
            alert_if_fails: 1,
            cooldown_mins: 1,
            collect_rum_data: true,
            session_replay: true,
            auth: Some(SyntheticAuth::Secret {
                secret_name: "NAME".into(),
            }),
            cookies: vec![Default::default()],
            variables: vec![Default::default()],
            environments: vec!["prod".into()],
            start: Some(1),
            config_secrets: Default::default(),
            next_run_at: 2,
            last_triggered_at: 1,
            last_check_status: Default::default(),
            last_run_class: 1,
            last_run_class_at: 1,
            confirm_failures: Some(true),
            alert_on: Some(AlertOn::Down),
            owner: Some("owner".into()),
            created_at: 1,
            updated_at: 1,
        };
        let value = serde_json::to_value(check).unwrap();
        assert!(
            SYNTHETICS_EXCLUDED
                .iter()
                .all(|path| value.pointer(path).is_some())
        );
        assert_partition(&value, "", SYNTHETICS_DIGESTED, SYNTHETICS_EXCLUDED);
        let key = KAuth::derive(&[7; 64]);
        let projected = projection(ConsumerType::SyntheticsCheck, &value, &[], &key, |_, _| {
            None
        })
        .unwrap();
        assert_partition(&projected, "", SYNTHETICS_DIGESTED, &[]);
    }

    #[test]
    fn auth_tag_binds_context_projection_dependencies_and_unique_field_id_pairs() {
        let key = KAuth::derive(&[7; 64]);
        let a = BoundRef {
            field: "/a".into(),
            token_name: "A".into(),
            secret_id: "id_2".into(),
        };
        let z = BoundRef {
            field: "/z".into(),
            token_name: "Z".into(),
            secret_id: "id_1".into(),
        };
        let renamed = BoundRef {
            token_name: "RENAMED".into(),
            ..a.clone()
        };
        let refs = [z.clone(), renamed.clone(), a];
        let deps = DepDigests::from([(ORG_ENV_ID.into(), empty_dep_digest())]);
        let input = AuthTagInput {
            org_id: "org",
            consumer_type: ConsumerType::AlertDestination,
            consumer_id: "dst",
            consumer_rev: 42,
            refs: &refs,
            delivery_digest: &sha256_hex(b"{}"),
            dep_digests: &deps,
        };
        let tag = key.auth_tag(&input);
        assert_eq!(
            tag,
            "ed5e9fc89f13ffa31b2f76a390cf07a51dabd4b86e8704f6d52c415b7ea79e98"
        );
        assert!(key.verify_auth_tag(&input, &tag));
        assert!(key.verify_auth_tag(
            &AuthTagInput {
                refs: &[renamed.clone(), z.clone()],
                ..input
            },
            &tag
        ));
        let changed_refs = [
            BoundRef {
                secret_id: "other".into(),
                ..renamed
            },
            z,
        ];
        let changed_deps = DepDigests::from([("prod".into(), empty_dep_digest())]);
        for changed in [
            AuthTagInput {
                delivery_digest: "changed",
                ..input
            },
            AuthTagInput {
                dep_digests: &changed_deps,
                ..input
            },
            AuthTagInput {
                consumer_rev: 43,
                ..input
            },
            AuthTagInput {
                refs: &changed_refs,
                ..input
            },
            AuthTagInput {
                org_id: "other",
                ..input
            },
            AuthTagInput {
                consumer_id: "other",
                ..input
            },
            AuthTagInput {
                consumer_type: ConsumerType::PipelineDestination,
                ..input
            },
        ] {
            assert!(!key.verify_auth_tag(&changed, &tag));
        }
        assert!(!KAuth::derive(&[8; 64]).verify_auth_tag(&input, &tag));
        for malformed in ["xz", "f", "00", ""] {
            assert!(!key.verify_auth_tag(&input, malformed));
        }
    }

    #[test]
    fn legacy_values_and_all_five_dependency_shapes_have_stable_digests() {
        const REV: &str = "VoUKakJhKokiYBx5xaEJlrSPXpf";
        const VH: &str = "dea5eba5a3c9ce6cd49b5418ced8af8f52be69344bfad218590b9f89a770e0ae";
        const ALL: &str = "68b61bf3305ba819e9d2bf3035cf3b21123c9fe4f835a09b16ccf42b003df5e3";
        let key = KAuth::derive(&[7; 64]);
        let updated_at = 1_700_000_000_000_000;
        let legacy = |value| DepEntry::legacy(&key, "TOKEN", "lv_1", updated_at, value);
        assert_eq!(legacy_rev("lv_1", updated_at), REV);
        assert_eq!(key.literal("v1"), VH);
        assert_eq!(
            legacy("v1").to_json(),
            json!({"name":"TOKEN","rev":REV,"vh":VH})
        );
        let mut entries = vec![
            DepEntry::Store {
                secret_id: "id_1".into(),
                value_rev: "r1".into(),
            },
            DepEntry::StoreMissing {
                secret_id: "id_2".into(),
            },
            legacy("v1"),
            DepEntry::Local {
                name: "LOCAL".into(),
            },
            DepEntry::Absent {
                name: "ABSENT".into(),
            },
        ];
        assert_eq!(dep_digest(&entries).unwrap(), ALL);
        entries.reverse();
        entries.push(entries[0].clone());
        assert_eq!(dep_digest(&entries).unwrap(), ALL);
        entries[2] = legacy("v2");
        assert_eq!(entries[2].to_json()["rev"], REV);
        assert_ne!(entries[2].to_json()["vh"], VH);
        assert_ne!(dep_digest(&entries).unwrap(), ALL);
    }
}
