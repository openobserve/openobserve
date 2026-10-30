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

//! OCSF mapping packs compiled into the binary.

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The OCSF schema version every pack targets.
pub const OCSF_VERSION: &str = "1.6.0";

/// `(manifest.json, pack.vrl)` of every directory under `packs/`.
const PACK_SOURCES: &[(&str, &str)] = &[(
    include_str!("packs/entity/manifest.json"),
    include_str!("packs/entity/pack.vrl"),
)];

static PACKS: LazyLock<Vec<OcsfPack>> = LazyLock::new(|| {
    PACK_SOURCES
        .iter()
        .map(|(manifest, vrl)| OcsfPack::parse(manifest, vrl))
        .collect()
});

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct OcsfPack {
    #[serde(flatten)]
    pub manifest: OcsfPackManifest,
    pub vrl: String,
}

impl OcsfPack {
    fn parse(manifest: &str, vrl: &str) -> Self {
        Self {
            // every embedded manifest is parsed by the manifest tests, so this cannot fail
            manifest: serde_json::from_str(manifest).expect("embedded OCSF pack manifest"),
            vrl: vrl.trim().to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OcsfPackManifest {
    pub id: String,
    pub version: u32,
    pub label: String,
    pub kind: OcsfPackKind,
    /// Classifier id in `web/src/utils/security/sourceTypes.ts`; `entity` for the entity pack.
    pub source_type: String,
    pub ocsf_classes: Vec<u32>,
    /// Lowercase flattened columns that must all be in a stream schema to offer the pack.
    pub requires_all: Vec<String>,
    pub product_name: String,
    pub vendor_name: String,
    #[serde(default, skip_serializing)]
    pub notes: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum OcsfPackKind {
    Full,
    Entity,
}

/// Every shipped pack, with its VRL trimmed of surrounding whitespace.
pub fn packs() -> &'static [OcsfPack] {
    &PACKS
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, HashSet},
        path::{Path, PathBuf},
    };

    use config::{
        meta::function::VRLResultResolver,
        utils::flatten::{flatten_with_level, format_key},
    };
    use serde_json::Value;

    use super::*;

    const INTEGER_COLUMNS: &[&str] = &[
        "class_uid",
        "category_uid",
        "activity_id",
        "type_uid",
        "severity_id",
        "status_id",
    ];

    /// One fixture run through its pack; `flat_input` and `output` are flattened at level 3.
    struct FixtureRun {
        name: String,
        pack: &'static OcsfPack,
        input: Value,
        flat_input: Value,
        raw_output: Value,
        output: Value,
    }

    fn packs_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/ocsf/packs")
    }

    fn pack_dirs() -> Vec<String> {
        let mut dirs = std::fs::read_dir(packs_dir())
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| entry.file_type().unwrap().is_dir())
            .map(|entry| entry.file_name().into_string().unwrap())
            .collect::<Vec<_>>();
        dirs.sort();
        dirs
    }

    fn read_json(path: &Path) -> Value {
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path:?}: {e}"))
    }

    fn compile(pack: &OcsfPack) -> VRLResultResolver {
        let compiled = transform::compile_vrl_function(&pack.vrl, "default")
            .unwrap_or_else(|e| panic!("{} does not compile: {e}", pack.manifest.id));
        VRLResultResolver {
            program: compiled.program,
            fields: compiled.fields,
        }
    }

    fn fixture_runs() -> Vec<FixtureRun> {
        let mut runtime = transform::init_vrl_runtime();
        let mut runs = Vec::new();
        for pack in packs() {
            let resolver = compile(pack);
            let dir = packs_dir().join(&pack.manifest.id).join("fixtures");
            let mut inputs = std::fs::read_dir(&dir)
                .unwrap_or_else(|e| panic!("{dir:?}: {e}"))
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .filter_map(|file| file.strip_suffix(".input.json").map(str::to_string))
                .collect::<Vec<_>>();
            inputs.sort();
            assert!(!inputs.is_empty(), "{} has no fixtures", pack.manifest.id);
            for case in inputs {
                let input = read_json(&dir.join(format!("{case}.input.json")));
                let (output, error) = transform::apply_vrl_fn(
                    &mut runtime,
                    &resolver,
                    input.clone(),
                    "default",
                    &["fixture_stream".to_string()],
                );
                let name = format!("{}/{case}", pack.manifest.id);
                assert_eq!(error, None, "{name}");
                runs.push(FixtureRun {
                    pack,
                    flat_input: flatten_with_level(input.clone(), 3).unwrap(),
                    output: flatten_with_level(output.clone(), 3).unwrap(),
                    raw_output: output,
                    input,
                    name,
                });
            }
        }
        runs
    }

    /// Column names `flatten_with_level(value, 3)` produces, duplicates kept.
    fn flat_keys(value: &Value, prefix: &str, depth: u32, keys: &mut Vec<String>) {
        match value {
            Value::Null => {}
            Value::Object(map) if depth < 3 => {
                for (key, value) in map {
                    let mut key = key.clone();
                    format_key(&mut key);
                    let key = if depth == 0 {
                        key
                    } else {
                        format!("{prefix}_{key}")
                    };
                    flat_keys(value, &key, depth + 1, keys);
                }
            }
            _ => keys.push(prefix.to_string()),
        }
    }

    fn expected(run: &FixtureRun) -> Value {
        let (pack, case) = run.name.split_once('/').unwrap();
        read_json(
            &packs_dir()
                .join(pack)
                .join("fixtures")
                .join(format!("{case}.expected.json")),
        )
    }

    #[test]
    fn test_ocsf_version_is_pinned() {
        assert_eq!(OCSF_VERSION, "1.6.0");
    }

    #[test]
    fn test_packs_returns_every_pack_directory() {
        let dirs = pack_dirs();
        assert_eq!(packs().len(), dirs.len(), "{dirs:?}");
        for dir in dirs {
            let pack = packs()
                .iter()
                .find(|pack| pack.manifest.id == dir)
                .unwrap_or_else(|| panic!("packs() has no pack for directory {dir}"));
            let path = packs_dir().join(&dir);
            let manifest: OcsfPackManifest =
                serde_json::from_value(read_json(&path.join("manifest.json"))).unwrap();
            assert_eq!(pack.manifest, manifest, "{dir}");
            let vrl = std::fs::read_to_string(path.join("pack.vrl")).unwrap();
            assert_eq!(pack.vrl, vrl.trim(), "{dir}");
        }
    }

    #[test]
    fn test_every_manifest_is_valid() {
        let mut seen = HashSet::new();
        for dir in pack_dirs() {
            let manifest = read_json(&packs_dir().join(&dir).join("manifest.json"));
            let manifest: OcsfPackManifest = serde_json::from_value(manifest)
                .unwrap_or_else(|e| panic!("{dir}/manifest.json: {e}"));
            assert_eq!(manifest.id, dir);
            assert!(
                seen.insert((manifest.id.clone(), manifest.version)),
                "{dir}"
            );
            assert!(manifest.version >= 1, "{dir}");
            for column in &manifest.requires_all {
                assert_eq!(*column, column.to_lowercase(), "{dir}");
            }
            if manifest.kind == OcsfPackKind::Entity {
                assert!(manifest.requires_all.is_empty(), "{dir}");
            }
        }
    }

    #[test]
    fn test_every_pack_compiles_and_ends_with_a_dot_line() {
        for pack in packs() {
            compile(pack);
            assert_eq!(pack.vrl.lines().last(), Some("."), "{}", pack.manifest.id);
        }
    }

    #[test]
    fn test_fixtures_yield_their_expected_columns() {
        for run in fixture_runs() {
            let expected = expected(&run);
            for (key, value) in expected.as_object().unwrap() {
                assert_eq!(run.output.get(key), Some(value), "{} {key}", run.name);
            }
        }
    }

    #[test]
    fn test_fixtures_keep_every_input_value() {
        for run in fixture_runs() {
            for (key, value) in run.flat_input.as_object().unwrap() {
                assert_eq!(run.output.get(key), Some(value), "{} {key}", run.name);
            }
        }
    }

    #[test]
    fn test_fixtures_never_write_a_column_the_event_has() {
        for run in fixture_runs() {
            let mut keys = Vec::new();
            flat_keys(&run.raw_output, "", 0, &mut keys);
            let mut seen = HashSet::new();
            for key in keys {
                assert!(seen.insert(key.clone()), "{} writes {key} twice", run.name);
            }
        }
    }

    #[test]
    fn test_fixtures_write_the_guaranteed_integer_columns() {
        for run in fixture_runs() {
            let int = |column: &str| {
                run.output
                    .get(column)
                    .and_then(Value::as_i64)
                    .unwrap_or_else(|| panic!("{} {column} is not an integer", run.name))
            };
            for column in INTEGER_COLUMNS {
                int(column);
            }
            assert_eq!(
                int("type_uid"),
                int("class_uid") * 100 + int("activity_id"),
                "{}",
                run.name
            );
            let tag = format!("{}@{}", run.pack.manifest.id, run.pack.manifest.version);
            assert_eq!(run.output["o2_ocsf_pack"], tag, "{}", run.name);
        }
    }

    #[test]
    fn test_packs_lock_holds_the_hash_of_every_pack() {
        let lock = std::fs::read_to_string(packs_dir().join("../packs.lock")).unwrap();
        let locked = lock
            .lines()
            .filter_map(|line| line.split_once(' '))
            .collect::<HashMap<_, _>>();
        for pack in packs() {
            let tag = format!("{}@{}", pack.manifest.id, pack.manifest.version);
            let hash = sha256::digest(pack.vrl.as_str());
            match locked.get(tag.as_str()) {
                None => panic!("packs.lock has no line for {tag}; add: {tag} {hash}"),
                Some(locked) => assert_eq!(
                    *locked,
                    hash,
                    "{tag} differs from packs.lock; a released version is never edited, so bump the version and add: {}@{} {hash}",
                    pack.manifest.id,
                    pack.manifest.version + 1
                ),
            }
        }
    }

    #[test]
    fn test_entity_time_is_the_ingest_clock_in_ms_when_absent() {
        let before = chrono::Utc::now().timestamp_millis();
        let runs = fixture_runs();
        let after = chrono::Utc::now().timestamp_millis();
        let entity = runs
            .iter()
            .filter(|run| run.pack.manifest.id == "entity")
            .collect::<Vec<_>>();
        assert!(entity.iter().any(|run| run.input.get("time").is_some()));
        for run in entity {
            match run.input.get("time") {
                Some(time) => assert_eq!(run.output.get("time"), Some(time), "{}", run.name),
                None => {
                    let time = run.output["time"].as_i64().unwrap();
                    assert!((before..=after).contains(&time), "{} {time}", run.name);
                }
            }
        }
    }
}
