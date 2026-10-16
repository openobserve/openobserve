// Copyright 2026 OpenObserve Inc.

use crate::errors::Error;

pub const PROMPTS_WATCH_PREFIX: &str = "/prompts/";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Invalidation {
    Label {
        org_id: String,
        entity_id: String,
        label: String,
    },
    Version {
        org_id: String,
        entity_id: String,
        version: i32,
    },
    Head {
        org_id: String,
        entity_id: String,
    },
}

pub fn label_key(org_id: &str, entity_id: &str, label: &str) -> String {
    format!(
        "{PROMPTS_WATCH_PREFIX}{}/{}/label/{}",
        encode(org_id),
        encode(entity_id),
        encode(label)
    )
}

pub fn version_key(org_id: &str, entity_id: &str, version: i32) -> String {
    format!(
        "{PROMPTS_WATCH_PREFIX}{}/{}/version/{version}",
        encode(org_id),
        encode(entity_id)
    )
}

pub fn head_key(org_id: &str, entity_id: &str) -> String {
    format!(
        "{PROMPTS_WATCH_PREFIX}{}/{}/head",
        encode(org_id),
        encode(entity_id)
    )
}

pub fn parse_key(key: &str) -> Option<Invalidation> {
    let parts = key
        .strip_prefix(PROMPTS_WATCH_PREFIX)?
        .split('/')
        .collect::<Vec<_>>();
    let org_id = decode(parts.first()?)?;
    let entity_id = decode(parts.get(1)?)?;
    match parts.as_slice() {
        [_, _, "head"] => Some(Invalidation::Head { org_id, entity_id }),
        [_, _, "label", label] => Some(Invalidation::Label {
            org_id,
            entity_id,
            label: decode(label)?,
        }),
        [_, _, "version", version] => Some(Invalidation::Version {
            org_id,
            entity_id,
            version: version.parse().ok()?,
        }),
        _ => None,
    }
}

pub async fn emit_label(org_id: &str, entity_id: &str, label: &str) -> Result<(), Error> {
    emit(&label_key(org_id, entity_id, label)).await
}

pub async fn emit_version(org_id: &str, entity_id: &str, version: i32) -> Result<(), Error> {
    emit(&version_key(org_id, entity_id, version)).await
}

pub async fn emit_head(org_id: &str, entity_id: &str) -> Result<(), Error> {
    emit(&head_key(org_id, entity_id)).await
}

async fn emit(key: &str) -> Result<(), Error> {
    super::get_coordinator()
        .await
        .put(key, bytes::Bytes::new(), true, None)
        .await
}

fn encode(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

fn decode(value: &str) -> Option<String> {
    urlencoding::decode(value)
        .ok()
        .map(|value| value.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_percent_encode_segments_and_round_trip() {
        let key = label_key("org/one", "entity?one", "release/candidate");
        assert_eq!(
            key,
            "/prompts/org%2Fone/entity%3Fone/label/release%2Fcandidate"
        );
        assert_eq!(
            parse_key(&key),
            Some(Invalidation::Label {
                org_id: "org/one".to_string(),
                entity_id: "entity?one".to_string(),
                label: "release/candidate".to_string(),
            })
        );
    }

    #[test]
    fn version_and_head_keys_are_distinct() {
        assert_eq!(
            parse_key(&version_key("org", "prompt", 3)),
            Some(Invalidation::Version {
                org_id: "org".to_string(),
                entity_id: "prompt".to_string(),
                version: 3,
            })
        );
        assert_eq!(
            parse_key(&head_key("org", "prompt")),
            Some(Invalidation::Head {
                org_id: "org".to_string(),
                entity_id: "prompt".to_string(),
            })
        );
    }
}
