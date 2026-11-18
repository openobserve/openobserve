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

//! Converts a pprof `profile.proto` upload into the OTLP profiles request the shared ingest path
//! stores. The body arrives already decompressed: the route relies on `Content-Encoding: gzip`.

use std::{
    collections::{HashMap, HashSet},
    hash::BuildHasher,
    sync::LazyLock,
};

use config::metrics;
use indexmap::IndexSet;
use opentelemetry_proto::tonic::{
    collector::profiles::v1development::ExportProfilesServiceRequest,
    common::v1::{AnyValue, KeyValue, any_value::Value},
    profiles::v1development as otlp,
    resource::v1::Resource,
};
use prost::Message;
use regex::Regex;

use super::{
    ProfilesExportError,
    query::{MAX_STACK_DEPTH, TRUNCATED_ANCESTORS_NAME},
};

const MAX_LOCATIONS: usize = 100_000;
const MAX_FUNCTIONS: usize = 100_000;
const MAX_STRINGS: usize = 200_000;
const MAX_MAPPINGS: usize = 100_000;
const MAX_SAMPLE_TYPES: usize = 32;
const MAX_TOTAL_VALUES: usize = 2_000_000;
const MAX_TOTAL_STACK_FRAMES: usize = 2_000_000;
const MAX_DURATION_NANOS: u64 = 3_600_000_000_000;
const MAX_RESOURCE_ATTRS_BYTES: usize = 4096;
const MAX_RESOURCE_ATTRS_PAIRS: usize = 32;
const MAX_SOURCE_ROOT_BYTES: usize = 512;
const MAX_TEXT_CHARS: usize = 200;
const MAX_TYPE_CHARS: usize = 64;
const MAX_RAW_CHARS: usize = 4096;
/// A composed nodejs frame over MAX_TEXT_CHARS keeps at most this much of the function name.
const MAX_NODE_NAME_CHARS: usize = 120;
const ELLIPSIS: &str = "...";
const OTHER_FRAME: &str = "[other]";
const ALLOWED_RESOURCE_KEYS: &[&str] = &[
    "service.name",
    "service.instance.id",
    "service.namespace",
    "deployment.environment",
    "host.name",
    "process.pid",
];

/// The separator between frames, and the Unicode control, format and line or paragraph separator
/// characters, none of which may reach a stored name.
static FORBIDDEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[;\p{Cc}\p{Cf}\p{Zl}\p{Zp}]").expect("valid regex"));

// Hand-written: generated pprof types need cpu-profiling; only the fields read here are declared.
/// pprof `Profile`, field tags as in the official `profile.proto`.
#[derive(Clone, PartialEq, Message)]
pub struct PprofProfile {
    #[prost(message, repeated, tag = "1")]
    pub sample_type: Vec<PprofValueType>,
    #[prost(message, repeated, tag = "2")]
    pub sample: Vec<PprofSample>,
    #[prost(message, repeated, tag = "3")]
    pub mapping: Vec<PprofMapping>,
    #[prost(message, repeated, tag = "4")]
    pub location: Vec<PprofLocation>,
    #[prost(message, repeated, tag = "5")]
    pub function: Vec<PprofFunction>,
    #[prost(string, repeated, tag = "6")]
    pub string_table: Vec<String>,
    #[prost(message, optional, tag = "11")]
    pub period_type: Option<PprofValueType>,
    #[prost(int64, tag = "12")]
    pub period: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofValueType {
    #[prost(int64, tag = "1")]
    pub kind: i64,
    #[prost(int64, tag = "2")]
    pub unit: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofSample {
    #[prost(uint64, repeated, tag = "1")]
    pub location_id: Vec<u64>,
    #[prost(int64, repeated, tag = "2")]
    pub value: Vec<i64>,
    #[prost(message, repeated, tag = "3")]
    pub label: Vec<PprofLabel>,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofLabel {
    #[prost(int64, tag = "1")]
    pub key: i64,
    #[prost(int64, tag = "2")]
    pub str: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofMapping {
    #[prost(uint64, tag = "1")]
    pub id: u64,
    #[prost(uint64, tag = "2")]
    pub memory_start: u64,
    #[prost(uint64, tag = "4")]
    pub file_offset: u64,
    #[prost(int64, tag = "5")]
    pub filename: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofLocation {
    #[prost(uint64, tag = "1")]
    pub id: u64,
    #[prost(uint64, tag = "2")]
    pub mapping_id: u64,
    #[prost(uint64, tag = "3")]
    pub address: u64,
    #[prost(message, repeated, tag = "4")]
    pub line: Vec<PprofLine>,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofLine {
    #[prost(uint64, tag = "1")]
    pub function_id: u64,
    #[prost(int64, tag = "2")]
    pub line: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct PprofFunction {
    #[prost(uint64, tag = "1")]
    pub id: u64,
    #[prost(int64, tag = "2")]
    pub name: i64,
    #[prost(int64, tag = "3")]
    pub system_name: i64,
    #[prost(int64, tag = "4")]
    pub filename: i64,
}

/// How frame names and sample types are derived from the upload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PprofRuntime {
    Generic,
    NodeJs,
    Python,
}

impl PprofRuntime {
    fn from_header(value: Option<&str>) -> Self {
        let value = value.map(str::trim).unwrap_or_default();
        if value.eq_ignore_ascii_case("nodejs") {
            Self::NodeJs
        } else if value.eq_ignore_ascii_case("python") {
            Self::Python
        } else {
            Self::Generic
        }
    }

    /// The runtimes whose frames are `<file>:<name>:<line>` and whose sample types take the
    /// `inuse_*` names.
    fn keeps_lines(self) -> bool {
        matches!(self, Self::NodeJs | Self::Python)
    }
}

/// The validated query string and headers of one pprof upload.
#[derive(Clone, Debug)]
pub struct PprofRequestMeta {
    pub start_unix_nano: u64,
    pub duration_nano: u64,
    pub resource_attributes: Vec<(String, String)>,
    pub source_root: Option<String>,
    pub runtime: PprofRuntime,
}

impl PprofRequestMeta {
    /// Takes the raw query string and the raw values of the three `x-o2-*` headers.
    pub fn parse(
        raw_query: Option<&str>,
        resource_attributes: Option<&str>,
        source_root: Option<&str>,
        runtime: Option<&str>,
    ) -> Result<Self, ProfilesExportError> {
        let (start_unix_nano, duration_nano) = parse_query(raw_query)?;
        Ok(Self {
            start_unix_nano,
            duration_nano,
            resource_attributes: parse_resource_attributes(resource_attributes)?,
            source_root: parse_source_root(source_root)?,
            runtime: PprofRuntime::from_header(runtime),
        })
    }
}

/// Size and volume caps applied to one upload.
#[derive(Clone, Copy, Debug)]
pub struct PprofLimits {
    /// Body bytes the route reads, after decompression.
    pub max_decoded_bytes: usize,
    pub max_stacks_per_type: usize,
    pub max_linked_rows_per_type: usize,
    /// Rows one request may store, across all its types; over it the per-type caps are halved.
    pub max_rows: usize,
    /// Stack text one request may store: the rendered stack length summed over its rows; over it
    /// the per-type caps are halved.
    pub max_stack_bytes: usize,
    pub max_samples: usize,
    /// Distinct rendered frames, and their UTF-8 bytes, one upload may produce; checked before
    /// interning.
    pub max_frames: usize,
    pub max_frame_bytes: usize,
    /// Labels, lines, location ids and values one upload may carry, counted on the wire before
    /// prost decodes (at most 16 bytes each once decoded).
    pub max_nested_entries: usize,
}

impl PprofLimits {
    pub fn from_config() -> Self {
        let limit = &config::get_config().limit;
        Self {
            max_decoded_bytes: limit.profiles_pprof_max_decoded_bytes,
            max_stacks_per_type: limit.profiles_pprof_max_stacks_per_type,
            max_linked_rows_per_type: limit.profiles_pprof_max_linked_rows_per_type,
            max_rows: limit.profiles_pprof_max_rows,
            max_stack_bytes: limit.profiles_pprof_max_stack_bytes,
            max_samples: limit.profiles_pprof_max_samples,
            max_frames: limit.profiles_pprof_max_frames,
            max_frame_bytes: limit.profiles_pprof_max_frame_bytes,
            max_nested_entries: limit.profiles_pprof_max_nested_entries,
        }
    }
}

type LinkKey = (Option<[u8; 16]>, Option<[u8; 8]>);
/// Value sums of one type, by (stack, link).
type Sums = HashMap<(i32, i32), i64>;

struct Tables<'a> {
    functions: HashMap<u64, &'a PprofFunction>,
    locations: HashMap<u64, &'a PprofLocation>,
    mappings: HashMap<u64, &'a PprofMapping>,
}

struct KeptType {
    index: usize,
    kind: String,
    unit: String,
    linkable: bool,
}

struct Row {
    stack: i32,
    link: i32,
    value: i64,
}

/// Rows of one type folded into an [other] row by the per-type caps: `topn` into a row of their
/// own link or the unlinked one, `unlinked` linked rows whose link lost its own [other] row.
#[derive(Clone, Copy, Default)]
struct Folded {
    topn: usize,
    unlinked: usize,
}

// A function and its one-line location share an index, so a function stack is a location stack.
struct Builder<'a> {
    profile: &'a PprofProfile,
    tables: Tables<'a>,
    meta: &'a PprofRequestMeta,
    limits: PprofLimits,
    // Index 0 of the sets below is the empty sentinel the dictionary needs.
    strings: IndexSet<String>,
    stacks: IndexSet<Vec<i32>>,
    links: IndexSet<LinkKey>,
    // Sanitised once per string index: names, and nodejs and python paths of filenames.
    names: HashMap<i64, String>,
    paths: HashMap<i64, String>,
    // Cleaned file name of each mapping, for unsymbolized locations.
    mapping_files: HashMap<u64, String>,
    // Rendered frame per (function id, line); the line is 0 in generic mode.
    line_frames: HashMap<(u64, i64), i32>,
    // Function index by its name's string index.
    function_ids: HashMap<i32, i32>,
    function_table: Vec<otlp::Function>,
    location_table: Vec<otlp::Location>,
    frame_bytes: usize,
    location_frames: HashMap<u64, Vec<i32>>,
    // Length of each stack as the shared path renders it: frames joined by ';'.
    stack_bytes: Vec<usize>,
    stack_frames: usize,
    other_stack: i32,
}

impl<'a> Builder<'a> {
    fn new(
        profile: &'a PprofProfile,
        tables: Tables<'a>,
        meta: &'a PprofRequestMeta,
        limits: PprofLimits,
    ) -> Self {
        Self {
            profile,
            tables,
            meta,
            limits,
            strings: IndexSet::from([String::new()]),
            stacks: IndexSet::from([Vec::new()]),
            links: IndexSet::from([(None, None)]),
            names: HashMap::new(),
            paths: HashMap::new(),
            mapping_files: HashMap::new(),
            line_frames: HashMap::new(),
            function_ids: HashMap::new(),
            function_table: vec![otlp::Function::default()],
            location_table: vec![otlp::Location::default()],
            frame_bytes: 0,
            location_frames: HashMap::new(),
            stack_bytes: vec![0],
            stack_frames: 0,
            other_stack: 0,
        }
    }

    fn text(&self, index: i64) -> &'a str {
        let profile: &'a PprofProfile = self.profile;
        pprof_str(&profile.string_table, index)
    }

    fn intern(&mut self, value: &str) -> i32 {
        if value.is_empty() {
            return 0;
        }
        let at = match self.strings.get_index_of(value) {
            Some(at) => at,
            None => self.strings.insert_full(value.to_string()).0,
        };
        table_index(at)
    }

    fn name(&mut self, index: i64) -> &str {
        let profile: &'a PprofProfile = self.profile;
        self.names
            .entry(index)
            .or_insert_with(|| sanitize(pprof_str(&profile.string_table, index), false))
    }

    fn path(&mut self, index: i64) -> &str {
        let profile: &'a PprofProfile = self.profile;
        let meta: &'a PprofRequestMeta = self.meta;
        self.paths.entry(index).or_insert_with(|| {
            let file = clean(pprof_str(&profile.string_table, index), true);
            node_path(&file, meta.source_root.as_deref())
        })
    }

    fn mapping_file(&mut self, mapping: &PprofMapping) -> &str {
        let profile: &'a PprofProfile = self.profile;
        self.mapping_files.entry(mapping.id).or_insert_with(|| {
            let path = clean(pprof_str(&profile.string_table, mapping.filename), true);
            path.rsplit('/').next().unwrap_or_default().to_string()
        })
    }

    // The frame count and text are bounded before anything is interned.
    fn function_index(&mut self, frame: &str) -> Result<i32, ProfilesExportError> {
        if let Some(&id) = self
            .strings
            .get_index_of(frame)
            .and_then(|at| self.function_ids.get(&table_index(at)))
        {
            return Ok(id);
        }
        self.frame_bytes = self.frame_bytes.saturating_add(frame.len());
        let (max_frames, max_bytes) = (self.limits.max_frames, self.limits.max_frame_bytes);
        if self.function_table.len() > max_frames || self.frame_bytes > max_bytes {
            return Err(too_large(format!(
                "profile renders more than {max_frames} distinct frames or {max_bytes} bytes of frame text"
            )));
        }
        let id = table_index(self.function_table.len());
        let name_strindex = self.intern(frame);
        self.function_table.push(otlp::Function {
            name_strindex,
            ..Default::default()
        });
        self.location_table.push(frame_location(id));
        self.function_ids.insert(name_strindex, id);
        Ok(id)
    }

    fn function_for(
        &mut self,
        function: &PprofFunction,
        line: i64,
    ) -> Result<Option<i32>, ProfilesExportError> {
        let line = if self.meta.runtime.keeps_lines() {
            line
        } else {
            0
        };
        if let Some(&index) = self.line_frames.get(&(function.id, line)) {
            return Ok(Some(index));
        }
        let mut base = self.name(function.name).to_string();
        if base.is_empty() {
            base = self.name(function.system_name).to_string();
        }
        if base.is_empty() {
            return Ok(None);
        }
        let frame = if self.meta.runtime.keeps_lines() {
            let path = self.path(function.filename);
            if path.is_empty() {
                base
            } else {
                node_frame(path, &base, line)
            }
        } else {
            base
        };
        let index = self.function_index(&frame)?;
        self.line_frames.insert((function.id, line), index);
        Ok(Some(index))
    }

    fn unsymbolized_frame(&mut self, location: &PprofLocation) -> Result<i32, ProfilesExportError> {
        let mapping = self.tables.mappings.get(&location.mapping_id).copied();
        let file = match mapping {
            Some(m) => self.mapping_file(m).to_string(),
            None => String::new(),
        };
        let offset = match mapping {
            Some(m)
                if !file.is_empty()
                    && m.memory_start != 0
                    && location.address >= m.memory_start =>
            {
                (location.address - m.memory_start)
                    .checked_add(m.file_offset)
                    .ok_or_else(|| {
                        invalid(format!(
                            "location {} has an address whose offset in mapping {} overflows",
                            location.id, m.id
                        ))
                    })?
            }
            _ => location.address,
        };
        let frame = if file.is_empty() {
            format!("0x{offset:x}")
        } else {
            format!("{file}+0x{offset:x}")
        };
        self.function_index(&cap_chars(frame, MAX_TEXT_CHARS))
    }

    fn ensure_location(&mut self, location_id: u64) -> Result<(), ProfilesExportError> {
        if self.location_frames.contains_key(&location_id) {
            return Ok(());
        }
        let mut frames = Vec::new();
        if let Some(&location) = self.tables.locations.get(&location_id) {
            for line in &location.line {
                let Some(&function) = self.tables.functions.get(&line.function_id) else {
                    continue;
                };
                if let Some(index) = self.function_for(function, line.line)? {
                    frames.push(index);
                }
            }
            if frames.is_empty() && location.address != 0 {
                frames.push(self.unsymbolized_frame(location)?);
            }
        }
        self.location_frames.insert(location_id, frames);
        Ok(())
    }

    // Stops at the depth limit; past the frame budget a new stack is refused and folds into
    // [other]. Returns the stack and, for a refused one, the hash of its frames.
    fn stack_for(
        &mut self,
        sample: &PprofSample,
    ) -> Result<(i32, Option<u64>), ProfilesExportError> {
        let mut frames: Vec<i32> = Vec::new();
        for &id in &sample.location_id {
            if frames.len() > MAX_STACK_DEPTH {
                break;
            }
            self.ensure_location(id)?;
            // Copy no more than the depth limit needs, however many inline lines a location has.
            let location = &self.location_frames[&id];
            let room = MAX_STACK_DEPTH + 1 - frames.len();
            frames.extend_from_slice(&location[..location.len().min(room)]);
        }
        if frames.len() > MAX_STACK_DEPTH {
            frames.truncate(MAX_STACK_DEPTH - 1);
            frames.push(self.function_index(TRUNCATED_ANCESTORS_NAME)?);
        }
        if !self.stacks.contains(&frames)
            && self.stack_frames + frames.len() > MAX_TOTAL_STACK_FRAMES
        {
            let hash = self.stacks.hasher().hash_one(&frames);
            return Ok((self.other_stack, Some(hash)));
        }
        Ok((self.intern_stack(frames), None))
    }

    fn frame_len(&self, function_index: i32) -> usize {
        usize::try_from(function_index)
            .ok()
            .and_then(|i| self.function_table.get(i))
            .and_then(|f| usize::try_from(f.name_strindex).ok())
            .and_then(|i| self.strings.get_index(i))
            .map_or(0, String::len)
    }

    fn intern_stack(&mut self, frames: Vec<i32>) -> i32 {
        if frames.is_empty() {
            return 0;
        }
        if let Some(at) = self.stacks.get_index_of(&frames) {
            return table_index(at);
        }
        self.stack_frames += frames.len();
        let separators = frames.len() - 1;
        let bytes = frames
            .iter()
            .fold(separators, |sum, &f| sum.saturating_add(self.frame_len(f)));
        self.stack_bytes.push(bytes);
        table_index(self.stacks.insert_full(frames).0)
    }

    // Interned before aggregation, so every type folds onto the same [other] stack.
    fn init_other_stack(&mut self) -> Result<(), ProfilesExportError> {
        let function_index = self.function_index(OTHER_FRAME)?;
        self.other_stack = self.intern_stack(vec![function_index]);
        Ok(())
    }

    fn link_for(&mut self, sample: &PprofSample) -> i32 {
        let mut trace_id = None;
        let mut span_id = None;
        for label in &sample.label {
            if label.str == 0 {
                continue;
            }
            match self.text(label.key) {
                "trace_id" if trace_id.is_none() => {
                    trace_id = decode_hex::<16>(self.text(label.str));
                }
                "span_id" if span_id.is_none() => {
                    span_id = decode_hex::<8>(self.text(label.str));
                }
                _ => {}
            }
        }
        if trace_id.is_none() && span_id.is_none() {
            return 0;
        }
        table_index(self.links.insert_full((trace_id, span_id)).0)
    }

    // Sums per type by (stack, link). Samples whose stack the frame budget refused sum onto
    // [other]; the rows they would have made are counted per type that has a value for them.
    fn aggregate(
        &mut self,
        kept: &[KeptType],
    ) -> Result<(Vec<Sums>, Vec<usize>), ProfilesExportError> {
        let profile: &'a PprofProfile = self.profile;
        let mut sums: Vec<Sums> = vec![HashMap::new(); kept.len()];
        let mut refused_rows: Vec<HashSet<(u64, i32)>> = vec![HashSet::new(); kept.len()];
        for sample in &profile.sample {
            let live = |linkable_only: bool| {
                kept.iter()
                    .any(|k| (k.linkable || !linkable_only) && sample.value[k.index] != 0)
            };
            if !live(false) {
                continue;
            }
            let (stack, refused) = self.stack_for(sample)?;
            let link = if live(true) { self.link_for(sample) } else { 0 };
            for (slot, kept_type) in kept.iter().enumerate() {
                let value = sample.value[kept_type.index];
                if value == 0 {
                    continue;
                }
                let link = if kept_type.linkable { link } else { 0 };
                let sum = sums[slot].entry((stack, link)).or_insert(0);
                *sum = sum.saturating_add(value);
                if let Some(hash) = refused {
                    refused_rows[slot].insert((hash, link));
                }
            }
        }
        Ok((sums, refused_rows.iter().map(HashSet::len).collect()))
    }

    fn row_bytes(&self, row: &Row) -> usize {
        usize::try_from(row.stack)
            .ok()
            .and_then(|i| self.stack_bytes.get(i))
            .copied()
            .unwrap_or(0)
    }

    // Highest value first; among equal values the shorter stack is kept, so the larger ones are
    // shed first.
    fn sort_rows(&self, rows: &mut [Row]) {
        rows.sort_by(|a, b| {
            b.value
                .cmp(&a.value)
                .then(self.row_bytes(a).cmp(&self.row_bytes(b)))
                .then(a.stack.cmp(&b.stack))
                .then(a.link.cmp(&b.link))
        });
    }

    // One [other] row per (type, link), so trace-filtered totals hold; past max_linked links the
    // rest fold into the unlinked [other].
    fn fold_rows(
        &self,
        sums: &Sums,
        (max_unlinked, max_linked): (usize, usize),
    ) -> (Vec<Row>, Folded) {
        let mut other: HashMap<i32, i64> = HashMap::new();
        let mut unlinked = Vec::new();
        let mut linked = Vec::new();
        for (&(stack, link), &value) in sums {
            if value == 0 {
                continue;
            }
            if stack == self.other_stack {
                add_value(&mut other, link, value);
            } else if link == 0 {
                unlinked.push(Row { stack, link, value });
            } else {
                linked.push(Row { stack, link, value });
            }
        }
        self.sort_rows(&mut unlinked);
        self.sort_rows(&mut linked);
        let mut folded = Folded::default();
        if unlinked.len() > max_unlinked {
            for row in unlinked.split_off(max_unlinked) {
                add_value(&mut other, 0, row.value);
                folded.topn += 1;
            }
        }
        let mut folded_links: HashMap<i32, usize> = HashMap::new();
        if linked.len() > max_linked {
            for row in linked.split_off(max_linked) {
                add_value(&mut other, row.link, row.value);
                *folded_links.entry(row.link).or_insert(0) += 1;
            }
        }
        let mut unlinked_other = other.remove(&0).unwrap_or(0);
        let mut link_others: Vec<(i32, i64)> =
            other.into_iter().filter(|(_, value)| *value != 0).collect();
        link_others.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        if link_others.len() > max_linked {
            for (link, value) in link_others.split_off(max_linked) {
                unlinked_other = unlinked_other.saturating_add(value);
                folded.unlinked += folded_links.remove(&link).unwrap_or(0);
            }
        }
        folded.topn += folded_links.values().sum::<usize>();
        let mut rows = unlinked;
        rows.extend(linked);
        rows.extend(link_others.into_iter().map(|(link, value)| Row {
            stack: self.other_stack,
            link,
            value,
        }));
        if unlinked_other != 0 {
            rows.push(Row {
                stack: self.other_stack,
                link: 0,
                value: unlinked_other,
            });
        }
        (rows, folded)
    }

    // Over the request budget, halves the linked cap, then the unlinked one, and folds again, so
    // the profile gets coarser instead of refused; 413 only when both caps are 1.
    fn fold_within_budget(
        &self,
        sums: &[Sums],
    ) -> Result<(Vec<Vec<Row>>, Vec<Folded>), ProfilesExportError> {
        let limits = &self.limits;
        // A cap at or over a type's own count folds nothing, so halving starts from the counts.
        let most = |linked: bool| {
            sums.iter()
                .map(|s| s.keys().filter(|(_, link)| (*link != 0) == linked).count())
                .max()
                .unwrap_or(0)
                .max(1)
        };
        let mut caps = (
            limits.max_stacks_per_type.min(most(false)),
            limits.max_linked_rows_per_type.min(most(true)),
        );
        loop {
            let mut used = (0_usize, 0_usize);
            let mut all_rows = Vec::with_capacity(sums.len());
            let mut all_folded = Vec::with_capacity(sums.len());
            for type_sums in sums {
                let (mut rows, folded) = self.fold_rows(type_sums, caps);
                if rows.is_empty() {
                    rows.push(Row {
                        stack: 0,
                        link: 0,
                        value: 0,
                    });
                }
                used.0 = used.0.saturating_add(rows.len());
                used.1 = rows.iter().fold(used.1, |bytes, row| {
                    bytes.saturating_add(self.row_bytes(row))
                });
                all_rows.push(rows);
                all_folded.push(folded);
            }
            if used.0 <= limits.max_rows && used.1 <= limits.max_stack_bytes {
                return Ok((all_rows, all_folded));
            }
            if caps.0 <= 1 && caps.1 <= 1 {
                return Err(too_large(format!(
                    "profile would store {} rows and {} bytes of stack text, over the limits of {} rows and {} bytes",
                    used.0, used.1, limits.max_rows, limits.max_stack_bytes
                )));
            }
            if caps.1 > 1 {
                caps.1 = (caps.1 / 2).max(1);
            } else {
                caps.0 = (caps.0 / 2).max(1);
            }
        }
    }

    fn value_type(&mut self, kind: &str, unit: &str) -> otlp::ValueType {
        otlp::ValueType {
            type_strindex: self.intern(kind),
            unit_strindex: self.intern(unit),
        }
    }

    fn build(
        mut self,
        kept: &[KeptType],
        org_id: &str,
    ) -> Result<ExportProfilesServiceRequest, ProfilesExportError> {
        let profile: &'a PprofProfile = self.profile;
        self.init_other_stack()?;
        let (sums, refused) = self.aggregate(kept)?;
        let (type_rows, folded) = self.fold_within_budget(&sums)?;
        let period_type = profile.period_type.as_ref().map(|vt| {
            let kind = cap_chars(clean(self.text(vt.kind), false), MAX_TYPE_CHARS);
            let unit = cap_chars(clean(self.text(vt.unit), false), MAX_TYPE_CHARS);
            self.value_type(&kind, &unit)
        });
        let mut profiles = Vec::with_capacity(kept.len());
        for (kept_type, rows) in kept.iter().zip(type_rows) {
            let samples = rows
                .into_iter()
                .map(|row| otlp::Sample {
                    stack_index: row.stack,
                    link_index: row.link,
                    values: vec![row.value],
                    ..Default::default()
                })
                .collect();
            profiles.push(otlp::Profile {
                sample_type: Some(self.value_type(&kept_type.kind, &kept_type.unit)),
                samples,
                time_unix_nano: self.meta.start_unix_nano,
                duration_nano: self.meta.duration_nano,
                period_type,
                period: profile.period,
                ..Default::default()
            });
        }
        for (slot, kept_type) in kept.iter().enumerate() {
            record_folds(org_id, &kept_type.kind, folded[slot], refused[slot]);
        }
        let dictionary = otlp::ProfilesDictionary {
            mapping_table: vec![otlp::Mapping::default()],
            location_table: self.location_table,
            function_table: self.function_table,
            link_table: std::iter::once(otlp::Link::default())
                .chain(
                    self.links
                        .iter()
                        .skip(1)
                        .map(|&(trace_id, span_id)| otlp::Link {
                            trace_id: trace_id.unwrap_or([0; 16]).to_vec(),
                            span_id: span_id.unwrap_or([0; 8]).to_vec(),
                        }),
                )
                .collect(),
            string_table: self.strings.into_iter().collect(),
            attribute_table: vec![otlp::KeyValueAndUnit::default()],
            stack_table: self
                .stacks
                .into_iter()
                .map(|location_indices| otlp::Stack { location_indices })
                .collect(),
        };
        let resource = Resource {
            attributes: self
                .meta
                .resource_attributes
                .iter()
                .map(|(key, value)| KeyValue {
                    key: key.clone(),
                    value: Some(AnyValue {
                        value: Some(Value::StringValue(value.clone())),
                    }),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        Ok(ExportProfilesServiceRequest {
            resource_profiles: vec![otlp::ResourceProfiles {
                resource: Some(resource),
                scope_profiles: vec![otlp::ScopeProfiles {
                    profiles,
                    ..Default::default()
                }],
                ..Default::default()
            }],
            dictionary: Some(dictionary),
        })
    }
}

fn frame_location(function_index: i32) -> otlp::Location {
    otlp::Location {
        lines: vec![otlp::Line {
            function_index,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn add_value(sums: &mut HashMap<i32, i64>, link: i32, value: i64) {
    let sum = sums.entry(link).or_insert(0);
    *sum = sum.saturating_add(value);
}

/// Converts one upload, already decompressed; `None` means a valid profile with no sample types,
/// which is a no-op.
pub fn convert(
    org_id: &str,
    raw: &[u8],
    meta: &PprofRequestMeta,
    limits: &PprofLimits,
) -> Result<Option<ExportProfilesServiceRequest>, ProfilesExportError> {
    precheck_counts(raw, limits)?;
    let profile =
        PprofProfile::decode(raw).map_err(|e| invalid(format!("invalid pprof protobuf: {e}")))?;
    if profile.sample_type.is_empty() {
        return Ok(None);
    }
    let tables = validate(&profile)?;
    let kept = select_types(&profile, meta.runtime)?;
    let builder = Builder::new(&profile, tables, meta, *limits);
    builder.build(&kept, org_id).map(Some)
}

/// Parses `start_unix_nano` and `duration_nano`, both required decimal u64 values.
pub fn parse_query(raw_query: Option<&str>) -> Result<(u64, u64), ProfilesExportError> {
    let mut start = None;
    let mut duration = None;
    for pair in raw_query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let slot = match key {
            "start_unix_nano" => &mut start,
            "duration_nano" => &mut duration,
            _ => continue,
        };
        if slot.is_some() {
            return Err(invalid(format!("duplicate query parameter {key}")));
        }
        *slot = Some(parse_decimal_u64(key, value)?);
    }
    let start = start.ok_or_else(|| invalid("query parameter start_unix_nano is required"))?;
    let duration = duration.ok_or_else(|| invalid("query parameter duration_nano is required"))?;
    if start == 0 {
        return Err(invalid("start_unix_nano must be greater than 0"));
    }
    if duration == 0 {
        return Err(invalid("duration_nano must be greater than 0"));
    }
    if duration > MAX_DURATION_NANOS {
        return Err(invalid("duration_nano must be at most 3600000000000 (1 h)"));
    }
    Ok((start, duration))
}

/// Parses `x-o2-resource-attributes`; `service.name` is required and only allowlisted keys pass.
pub fn parse_resource_attributes(
    header: Option<&str>,
) -> Result<Vec<(String, String)>, ProfilesExportError> {
    let raw = header.ok_or_else(|| invalid("header x-o2-resource-attributes is required"))?;
    if raw.len() > MAX_RESOURCE_ATTRS_BYTES {
        return Err(invalid(format!(
            "header x-o2-resource-attributes exceeds {MAX_RESOURCE_ATTRS_BYTES} bytes"
        )));
    }
    let pieces: Vec<&str> = raw.split(',').collect();
    if pieces.len() > MAX_RESOURCE_ATTRS_PAIRS {
        return Err(invalid(format!(
            "header x-o2-resource-attributes has more than {MAX_RESOURCE_ATTRS_PAIRS} pairs"
        )));
    }
    let mut attributes: Vec<(String, String)> = Vec::with_capacity(pieces.len());
    for piece in pieces {
        let (raw_key, raw_value) = piece
            .split_once('=')
            .ok_or_else(|| invalid("resource attribute pair needs key=value"))?;
        let key = percent_decode(raw_key)?;
        let value = strip_forbidden(&percent_decode(raw_value)?);
        if !ALLOWED_RESOURCE_KEYS.contains(&key.as_str()) {
            return Err(invalid(format!(
                "resource attribute key {key:?} is not allowed"
            )));
        }
        match attributes.iter_mut().find(|(k, _)| *k == key) {
            Some(existing) => existing.1 = value,
            None => attributes.push((key, value)),
        }
    }
    let has_service = attributes
        .iter()
        .any(|(k, v)| k == "service.name" && !v.trim().is_empty());
    if !has_service {
        return Err(invalid("resource attribute service.name is required"));
    }
    Ok(attributes)
}

/// Parses the optional percent-encoded `x-o2-source-root` header.
pub fn parse_source_root(header: Option<&str>) -> Result<Option<String>, ProfilesExportError> {
    let Some(raw) = header else {
        return Ok(None);
    };
    if raw.len() > MAX_SOURCE_ROOT_BYTES {
        return Err(invalid(format!(
            "header x-o2-source-root exceeds {MAX_SOURCE_ROOT_BYTES} bytes"
        )));
    }
    let decoded = percent_decode(raw)?;
    let root = decoded.trim_end_matches('/');
    Ok((!root.is_empty()).then(|| root.to_string()))
}

fn invalid(message: impl Into<String>) -> ProfilesExportError {
    ProfilesExportError::InvalidArgument(message.into())
}

fn too_large(message: impl Into<String>) -> ProfilesExportError {
    ProfilesExportError::PayloadTooLarge(message.into())
}

fn malformed() -> ProfilesExportError {
    invalid("invalid pprof protobuf: malformed field")
}

fn table_index(len: usize) -> i32 {
    i32::try_from(len).unwrap_or(i32::MAX)
}

fn parse_decimal_u64(name: &str, value: &str) -> Result<u64, ProfilesExportError> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid(format!(
            "query parameter {name} must be a decimal unsigned integer"
        )));
    }
    value
        .parse::<u64>()
        .map_err(|_| invalid(format!("query parameter {name} is out of range")))
}

// urlencoding passes a malformed escape through as text; here it is a 400.
fn percent_decode(raw: &str) -> Result<String, ProfilesExportError> {
    let well_formed = raw.split('%').skip(1).all(|rest| {
        rest.as_bytes()
            .get(..2)
            .is_some_and(|hex| hex.iter().all(u8::is_ascii_hexdigit))
    });
    if !well_formed {
        return Err(invalid("invalid percent escape in header"));
    }
    urlencoding::decode(raw)
        .map(std::borrow::Cow::into_owned)
        .map_err(|_| invalid("header is not valid UTF-8 after percent decoding"))
}

// Like prost, a varint longer than 10 bytes is malformed.
fn read_varint(bytes: &[u8], pos: &mut usize) -> Option<u64> {
    let mut value = 0_u64;
    for shift in (0..70).step_by(7) {
        let byte = *bytes.get(*pos)?;
        *pos += 1;
        value |= u64::from(byte & 0x7f).checked_shl(shift)?;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

// Calls `each` with the field number of every field of one message, and the payload of a
// length-delimited one.
fn scan_fields(
    bytes: &[u8],
    mut each: impl FnMut(u64, Option<&[u8]>) -> Result<(), ProfilesExportError>,
) -> Result<(), ProfilesExportError> {
    let mut pos = 0;
    while pos < bytes.len() {
        let key = read_varint(bytes, &mut pos).ok_or_else(malformed)?;
        let skip = match key & 7 {
            0 => {
                read_varint(bytes, &mut pos).ok_or_else(malformed)?;
                0
            }
            1 => 8,
            5 => 4,
            2 => read_varint(bytes, &mut pos)
                .and_then(|len| usize::try_from(len).ok())
                .ok_or_else(malformed)?,
            _ => return Err(malformed()),
        };
        let start = pos;
        pos = pos
            .checked_add(skip)
            .filter(|p| *p <= bytes.len())
            .ok_or_else(malformed)?;
        each(key >> 3, (key & 7 == 2).then(|| &bytes[start..pos]))?;
    }
    Ok(())
}

// Counts the repeated records before prost allocates them: a 2-byte record becomes 70 bytes or
// more once decoded at the top level, 8 to 16 bytes inside a sample or location.
fn precheck_counts(bytes: &[u8], limits: &PprofLimits) -> Result<(), ProfilesExportError> {
    let mut counts = [0_usize; 7];
    let mut nested = 0_usize;
    scan_fields(bytes, |field, payload| {
        if let Some(count) = usize::try_from(field).ok().and_then(|f| counts.get_mut(f)) {
            *count += 1;
        }
        // sample location_id and value entries, packed or not, and labels; location lines
        match (field, payload) {
            (2, Some(sample)) => scan_fields(sample, |inner, packed| {
                nested += match (inner, packed) {
                    // a packed varint ends at each byte without the continuation bit
                    (1 | 2, Some(packed)) => packed.iter().filter(|&&b| b < 0x80).count(),
                    (1..=3, _) => 1,
                    _ => 0,
                };
                Ok(())
            }),
            (4, Some(location)) => scan_fields(location, |inner, _| {
                nested += usize::from(inner == 4);
                Ok(())
            }),
            _ => Ok(()),
        }
    })?;
    if nested > limits.max_nested_entries {
        return Err(too_large(format!(
            "profile has more than {} sample labels, location lines and sample entries",
            limits.max_nested_entries
        )));
    }
    if counts[1] > MAX_SAMPLE_TYPES {
        return Err(invalid(format!(
            "more than {MAX_SAMPLE_TYPES} sample types"
        )));
    }
    if counts[2].saturating_mul(counts[1]) > MAX_TOTAL_VALUES {
        return Err(too_large(format!(
            "profile has more than {MAX_TOTAL_VALUES} sample values"
        )));
    }
    for (count, max, what) in [
        (counts[2], limits.max_samples, "samples"),
        (counts[3], MAX_MAPPINGS, "mappings"),
        (counts[4], MAX_LOCATIONS, "locations"),
        (counts[5], MAX_FUNCTIONS, "functions"),
        (counts[6], MAX_STRINGS, "strings"),
    ] {
        if count > max {
            return Err(too_large(format!("profile has more than {max} {what}")));
        }
    }
    Ok(())
}

fn pprof_str(table: &[String], index: i64) -> &str {
    usize::try_from(index)
        .ok()
        .and_then(|i| table.get(i))
        .map_or("", String::as_str)
}

fn check_string(table: &[String], index: i64, what: &str) -> Result<(), ProfilesExportError> {
    if index == 0 {
        return Ok(());
    }
    if index < 0 || index as usize >= table.len() {
        return Err(invalid(format!(
            "{what}: string index {index} is outside string_table length {}",
            table.len()
        )));
    }
    Ok(())
}

fn check_value_type(
    table: &[String],
    value_type: &PprofValueType,
    what: &str,
) -> Result<(), ProfilesExportError> {
    check_string(table, value_type.kind, what)?;
    check_string(table, value_type.unit, what)
}

fn index_by_id<'a, T>(
    items: &'a [T],
    id_of: impl Fn(&T) -> u64,
    what: &str,
) -> Result<HashMap<u64, &'a T>, ProfilesExportError> {
    let mut by_id = HashMap::with_capacity(items.len());
    for item in items {
        let id = id_of(item);
        if id == 0 {
            return Err(invalid(format!("{what} id must be non-zero")));
        }
        if by_id.insert(id, item).is_some() {
            return Err(invalid(format!("duplicate {what} id {id}")));
        }
    }
    Ok(by_id)
}

fn validate(profile: &PprofProfile) -> Result<Tables<'_>, ProfilesExportError> {
    let strings = &profile.string_table;
    if strings.first().is_some_and(|s| !s.is_empty()) {
        return Err(invalid("string_table[0] must be the empty string"));
    }
    for value_type in profile.sample_type.iter().chain(profile.period_type.iter()) {
        check_value_type(strings, value_type, "value type")?;
    }
    let mappings = index_by_id(&profile.mapping, |m| m.id, "mapping")?;
    for mapping in &profile.mapping {
        check_string(strings, mapping.filename, "mapping filename")?;
    }
    let functions = index_by_id(&profile.function, |f| f.id, "function")?;
    for function in &profile.function {
        check_string(strings, function.name, "function name")?;
        check_string(strings, function.system_name, "function system_name")?;
        check_string(strings, function.filename, "function filename")?;
    }
    let locations = index_by_id(&profile.location, |l| l.id, "location")?;
    for location in &profile.location {
        if location.mapping_id != 0 && !mappings.contains_key(&location.mapping_id) {
            return Err(invalid(format!(
                "location {} references unknown mapping {}",
                location.id, location.mapping_id
            )));
        }
        for line in &location.line {
            if line.function_id != 0 && !functions.contains_key(&line.function_id) {
                return Err(invalid(format!(
                    "location {} references unknown function {}",
                    location.id, line.function_id
                )));
            }
        }
    }
    for sample in &profile.sample {
        if sample.value.len() != profile.sample_type.len() {
            return Err(invalid(format!(
                "sample has {} values for {} sample types",
                sample.value.len(),
                profile.sample_type.len()
            )));
        }
        if let Some(id) = sample
            .location_id
            .iter()
            .find(|id| !locations.contains_key(*id))
        {
            return Err(invalid(format!("sample references unknown location {id}")));
        }
        for label in &sample.label {
            check_string(strings, label.key, "label key")?;
            check_string(strings, label.str, "label value")?;
        }
    }
    Ok(Tables {
        functions,
        locations,
        mappings,
    })
}

fn check_type_name(kind: &str) -> Result<(), ProfilesExportError> {
    let plain = kind
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'/' | b'-'));
    if kind.is_empty() || kind.len() > MAX_TYPE_CHARS || !plain {
        return Err(invalid(format!(
            "sample type names must be 1 to {MAX_TYPE_CHARS} characters of A-Z, a-z, 0-9, _ . / -"
        )));
    }
    Ok(())
}

fn select_types(
    profile: &PprofProfile,
    runtime: PprofRuntime,
) -> Result<Vec<KeptType>, ProfilesExportError> {
    let strings = &profile.string_table;
    for value_type in &profile.sample_type {
        check_type_name(pprof_str(strings, value_type.kind))?;
    }
    let has_time = profile.sample_type.iter().any(|vt| {
        let kind = pprof_str(strings, vt.kind);
        kind == "wall" || kind == "cpu"
    });
    let mut kept: Vec<KeptType> = Vec::with_capacity(profile.sample_type.len());
    for (index, vt) in profile.sample_type.iter().enumerate() {
        let (kind, unit) = (pprof_str(strings, vt.kind), pprof_str(strings, vt.unit));
        let kind = match (kind, unit) {
            ("objects", "count") if runtime.keeps_lines() => "inuse_objects",
            ("space", "bytes") if runtime.keeps_lines() => "inuse_space",
            ("sample", "count") if runtime.keeps_lines() && has_time => continue,
            _ => kind,
        };
        if kept.iter().any(|k| k.kind == kind) {
            return Err(invalid(format!("duplicate sample type {kind:?}")));
        }
        kept.push(KeptType {
            index,
            kind: kind.to_string(),
            unit: cap_chars(clean(unit, false), MAX_TYPE_CHARS),
            linkable: kind == "cpu" || kind == "wall",
        });
    }
    Ok(kept)
}

// Only known mapped names label a metric; the rest is `other`, which bounds the cardinality.
fn metric_type_label(kind: &str) -> &'static str {
    match kind {
        "cpu" => "cpu",
        "wall" => "wall",
        "inuse_space" => "inuse_space",
        "inuse_objects" => "inuse_objects",
        _ => "other",
    }
}

// Rows, all from the pass that fit: `topn` and `unlinked` at the caps it used, which the
// request-wide budgets may have halved, and `budget` the rows the frame budget refused.
fn record_folds(org_id: &str, kind: &str, folded: Folded, budget: usize) {
    let label = metric_type_label(kind);
    for (reason, count) in [
        ("topn", folded.topn),
        ("unlinked", folded.unlinked),
        ("budget", budget),
    ] {
        metrics::PROFILES_PPROF_FOLDED_ROWS
            .with_label_values(&[org_id, label, reason])
            .inc_by(count as u64);
    }
}

// Lowercase hex of exactly N bytes, not all zero; the length is checked before any scan.
fn decode_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != N * 2 || text.bytes().any(|b| b.is_ascii_uppercase()) {
        return None;
    }
    let mut out = [0_u8; N];
    hex::decode_to_slice(text, &mut out).ok()?;
    (out != [0_u8; N]).then_some(out)
}

fn strip_forbidden(raw: &str) -> String {
    let capped: String = raw.chars().take(MAX_RAW_CHARS).collect();
    FORBIDDEN.replace_all(&capped, "").into_owned()
}

fn cap_chars(mut text: String, max: usize) -> String {
    if let Some((at, _)) = text.char_indices().nth(max) {
        text.truncate(at);
    }
    text
}

// Strips first, so a delimiter split by a forbidden character still matches; the caller caps.
fn clean(raw: &str, filename: bool) -> String {
    let stripped = strip_forbidden(raw);
    let mut text = stripped.as_str();
    if let Some(at) = text.find("eval at ") {
        text = &text[..at + "eval".len()];
    }
    if filename {
        let cut = ["?", "#", " ("].iter().filter_map(|p| text.find(*p)).min();
        if let Some(at) = cut {
            text = &text[..at];
        }
    }
    text.to_string()
}

fn sanitize(raw: &str, filename: bool) -> String {
    cap_chars(clean(raw, filename), MAX_TEXT_CHARS)
}

// Over MAX_TEXT_CHARS, `:name:line` stays whole and the path loses its head, so two functions of
// one long path stay distinct.
fn node_frame(path: &str, base: &str, line: i64) -> String {
    let full = format!("{path}:{base}:{line}");
    if full.chars().count() <= MAX_TEXT_CHARS {
        return full;
    }
    let tail = format!(
        ":{}:{line}",
        cap_chars(base.to_string(), MAX_NODE_NAME_CHARS)
    );
    let room = MAX_TEXT_CHARS.saturating_sub(tail.chars().count());
    let path_chars = path.chars().count();
    if path_chars <= room {
        return format!("{path}{tail}");
    }
    let keep = room.saturating_sub(ELLIPSIS.len());
    let kept: String = path.chars().skip(path_chars - keep).collect();
    format!("{ELLIPSIS}{kept}{tail}")
}

fn node_path(file: &str, source_root: Option<&str>) -> String {
    let file = file.strip_prefix("file://").unwrap_or(file);
    if let Some(root) = source_root {
        if file == root {
            return ".".to_string();
        }
        if let Some(rest) = file.strip_prefix(root)
            && rest.starts_with('/')
        {
            return format!(".{rest}");
        }
    }
    if file.starts_with('/') {
        let segments: Vec<&str> = file.split('/').filter(|s| !s.is_empty()).collect();
        return segments[segments.len().saturating_sub(2)..].join("/");
    }
    file.to_string()
}

#[cfg(test)]
mod tests {
    use config::utils::{json, time::now_micros};

    use super::*;
    use crate::profiles::{build_sample_records, validation};

    const TIME_FIXTURE_B64: &str = include_str!("testdata/pprof_ingest/time-profile.pb.gz.b64");
    const HEAP_FIXTURE_B64: &str = include_str!("testdata/pprof_ingest/heap-profile.pb.gz.b64");
    const TIME_FIXTURE_SHA256: &str =
        "272eeb640abf600a33d215b9f4206350d8c71d9540714c386b80a501d7fdec01";
    const HEAP_FIXTURE_SHA256: &str =
        "8898df511494d013491f4b9a2aa2e0a4935db3df98e861e0b132e24c017d32ba";
    const CONTRACT: &str = include_str!("testdata/pprof_ingest/pprof-ingest-contract.json");
    const ROOT: &str = "/app/example-server";

    type Request = ExportProfilesServiceRequest;

    struct Fx {
        profile: PprofProfile,
    }

    impl Fx {
        fn new() -> Self {
            Self {
                profile: PprofProfile {
                    string_table: vec![String::new()],
                    ..Default::default()
                },
            }
        }

        fn s(&mut self, text: &str) -> i64 {
            if let Some(at) = self.profile.string_table.iter().position(|t| t == text) {
                return at as i64;
            }
            self.profile.string_table.push(text.to_string());
            self.profile.string_table.len() as i64 - 1
        }

        fn sample_type(mut self, kind: &str, unit: &str) -> Self {
            let (kind, unit) = (self.s(kind), self.s(unit));
            self.profile.sample_type.push(PprofValueType { kind, unit });
            self
        }

        fn func(mut self, id: u64, name: &str, file: &str) -> Self {
            let (name, filename) = (self.s(name), self.s(file));
            self.profile.function.push(PprofFunction {
                id,
                name,
                filename,
                ..Default::default()
            });
            self
        }

        fn loc(mut self, id: u64, lines: &[(u64, i64)]) -> Self {
            let line = lines
                .iter()
                .map(|&(function_id, line)| PprofLine { function_id, line })
                .collect();
            self.profile.location.push(PprofLocation {
                id,
                line,
                ..Default::default()
            });
            self
        }

        fn sample(mut self, locations: &[u64], values: &[i64], labels: &[(&str, &str)]) -> Self {
            let label = labels
                .iter()
                .map(|(key, value)| PprofLabel {
                    key: self.s(key),
                    str: self.s(value),
                })
                .collect();
            self.profile.sample.push(PprofSample {
                location_id: locations.to_vec(),
                value: values.to_vec(),
                label,
            });
            self
        }

        fn bytes(&self) -> Vec<u8> {
            self.profile.encode_to_vec()
        }

        fn run(&self, runtime: PprofRuntime) -> Request {
            let meta = meta(runtime, Some(ROOT));
            let request = convert("pprof_test_org", &self.bytes(), &meta, &limits());
            request.unwrap().unwrap()
        }
    }

    // one cpu type with distinct one-frame stacks fn1.. of the given values
    fn stacks(values: &[i64]) -> Fx {
        let mut fx = Fx::new().sample_type("cpu", "nanoseconds");
        for (i, value) in values.iter().enumerate() {
            let id = i as u64 + 1;
            fx = fx
                .func(id, &format!("fn{id}"), "")
                .loc(id, &[(id, 1)])
                .sample(&[id], &[*value], &[]);
        }
        fx
    }

    fn meta(runtime: PprofRuntime, root: Option<&str>) -> PprofRequestMeta {
        PprofRequestMeta {
            start_unix_nano: 1_762_560_000_000_000_000,
            duration_nano: 60_000_000_000,
            resource_attributes: vec![("service.name".to_string(), "svc".to_string())],
            source_root: root.map(str::to_string),
            runtime,
        }
    }

    fn limits() -> PprofLimits {
        PprofLimits {
            max_decoded_bytes: 16 * 1024 * 1024,
            max_stacks_per_type: 2500,
            max_linked_rows_per_type: 10_000,
            max_rows: 50_000,
            max_stack_bytes: 64 * 1024 * 1024,
            max_samples: 200_000,
            max_frames: 100_000,
            max_frame_bytes: 8 * 1024 * 1024,
            max_nested_entries: 8_000_000,
        }
    }

    fn invalid_message(result: Result<Option<Request>, ProfilesExportError>) -> String {
        match result {
            Err(ProfilesExportError::InvalidArgument(message)) => message,
            other => panic!("expected InvalidArgument, got {other:?}"),
        }
    }

    fn assert_too_large(result: Result<Option<Request>, ProfilesExportError>) {
        assert!(
            matches!(result, Err(ProfilesExportError::PayloadTooLarge(_))),
            "expected PayloadTooLarge, got {result:?}"
        );
    }

    fn rows(request: &Request) -> Vec<json::Map<String, json::Value>> {
        let resource = &request.resource_profiles[0];
        let scope = &resource.scope_profiles[0];
        let dictionary = request.dictionary.as_ref();
        let records =
            |profile| build_sample_records(resource, scope, profile, dictionary, 0, i64::MAX).0;
        scope.profiles.iter().flat_map(records).collect()
    }

    // (stack, value) of the stored rows of one type, sorted
    fn rows_of(request: &Request, profile_type: &str) -> Vec<(String, i64)> {
        let mut found: Vec<(String, i64)> = rows(request)
            .iter()
            .filter(|row| row["profile_type"] == profile_type)
            .map(|row| {
                (
                    row["stack"].as_str().unwrap().to_string(),
                    row["value"].as_i64().unwrap(),
                )
            })
            .collect();
        found.sort();
        found
    }

    // The fixtures are stored as base64 text so they stay text files in a diff.
    // Returns the gunzipped body, which the route's decompression layer would hand over.
    fn fixture(encoded: &str, sha256: &str) -> Vec<u8> {
        use std::io::Read;

        use base64::Engine;
        use sha2::{Digest, Sha256};

        let gz = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .unwrap();
        let digest: String = Sha256::digest(&gz)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(digest, sha256);
        let mut body = Vec::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_end(&mut body)
            .unwrap();
        body
    }

    // Replays the fixtures with the headers and query of the contract file.
    #[test]
    fn contract_fixtures_replay_as_the_backend_expects() {
        let contract: json::Value = json::from_str(CONTRACT).unwrap();
        for (index, encoded, sha256) in [
            (0, TIME_FIXTURE_B64, TIME_FIXTURE_SHA256),
            (1, HEAP_FIXTURE_B64, HEAP_FIXTURE_SHA256),
        ] {
            let case = &contract["requests"][index];
            let headers = &case["headers"];
            let query = format!(
                "start_unix_nano={}&duration_nano={}",
                now_micros() as u64 * 1000,
                case["query"]["duration_nano"].as_str().unwrap()
            );
            let meta = PprofRequestMeta::parse(
                Some(&query),
                headers["x-o2-resource-attributes"].as_str(),
                headers["x-o2-source-root"].as_str(),
                headers["x-o2-pprof-runtime"].as_str(),
            )
            .unwrap();
            assert_eq!(meta.runtime, PprofRuntime::NodeJs);
            assert_eq!(meta.source_root.as_deref(), Some(ROOT));
            let body = fixture(encoded, sha256);
            let request = convert("pprof_contract_org", &body, &meta, &limits())
                .unwrap()
                .unwrap();
            validation::validate(&request).unwrap();

            // the contract lists the profile types unordered
            let strings = &request.dictionary.as_ref().unwrap().string_table;
            let profiles = &request.resource_profiles[0].scope_profiles[0].profiles;
            let mut found: Vec<&str> = profiles
                .iter()
                .map(|p| strings[p.sample_type.as_ref().unwrap().type_strindex as usize].as_str())
                .collect();
            let mut want: Vec<&str> = case["expected"]["profile_types"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t.as_str().unwrap())
                .collect();
            found.sort();
            want.sort();
            assert_eq!(found, want);

            let total = |kind: &str| rows_of(&request, kind).iter().map(|r| r.1).sum::<i64>();
            let row = &rows(&request)[0];
            if index == 0 {
                assert_eq!(
                    (total("cpu"), total("wall")),
                    (1_556_527_167, 1_493_807_000)
                );
                assert!(rows_of(&request, "cpu").contains(&("(idle)".to_string(), 2_925_958)));
                assert!(
                    rows_of(&request, "cpu")
                        .iter()
                        .all(|(s, _)| !s.contains(ROOT))
                );
                assert_eq!(row["service_name"], "example-api");
                assert_eq!(row["process_pid"], "4242");
                assert_eq!(row["duration_nanos"], 60_000_000_000_i64);
            } else {
                assert_eq!(total("inuse_space"), 111_138_553);
                assert_eq!(total("inuse_objects"), 3_676_177);
                assert_eq!(row["period_type"], "space");
                assert_eq!(row["period"], 524_288);
            }
        }
    }

    #[test]
    fn query_and_header_rejects() {
        let ok = parse_query(Some("start_unix_nano=5&duration_nano=7&extra=x")).unwrap();
        assert_eq!(ok, (5, 7));
        for query in [
            None,
            Some("start_unix_nano=5"),
            Some("start_unix_nano=-5&duration_nano=7"),
            Some("start_unix_nano=0&duration_nano=7"),
            Some("start_unix_nano=5&duration_nano=0"),
            Some("start_unix_nano=5&start_unix_nano=6&duration_nano=7"),
            Some("start_unix_nano=1&duration_nano=3600000000001"),
        ] {
            assert!(parse_query(query).is_err(), "{query:?}");
        }

        // percent-decoded once, the last duplicate wins
        let header = "service.name=a%2Cb%3Dc,host.name=h1,host.name=h2,process.pid=%2541";
        let attrs = parse_resource_attributes(Some(header)).unwrap();
        let want = [
            ("service.name", "a,b=c"),
            ("host.name", "h2"),
            ("process.pid", "%41"),
        ];
        assert_eq!(attrs, want.map(|(k, v)| (k.to_string(), v.to_string())));
        let many = |n: usize| format!("service.name=svc{}", ",host.name=h".repeat(n - 1));
        let oversize = "v".repeat(MAX_RESOURCE_ATTRS_BYTES);
        let oversize = format!("service.name={oversize}");
        assert!(parse_resource_attributes(Some(&many(32))).is_ok());
        for header in [
            None,
            Some("host.name=h"),
            Some("service.name="),
            Some("service.name=a%zz"),
            Some("service.name=a%2"),
            Some("service.name=%ff"),
            Some(many(33).as_str()),
            Some(oversize.as_str()),
        ] {
            assert!(parse_resource_attributes(header).is_err(), "{header:?}");
        }
        // columns the backend must not set from a header
        for key in ["trace.id", "trace_id", "thread_id", "Service.Name"] {
            let header = format!("service.name=svc,{key}=x");
            let message = match parse_resource_attributes(Some(&header)) {
                Err(ProfilesExportError::InvalidArgument(message)) => message,
                other => panic!("{key}: {other:?}"),
            };
            assert!(message.contains("not allowed"), "{key}: {message}");
        }

        assert!(parse_source_root(Some("%2Fapp%zz")).is_err());
        assert!(parse_source_root(Some(&"a".repeat(MAX_SOURCE_ROOT_BYTES + 1))).is_err());

        // the runtime header: case-insensitive and trimmed; anything else is generic
        for (value, runtime) in [
            (Some("nodejs"), PprofRuntime::NodeJs),
            (Some(" Python "), PprofRuntime::Python),
            (Some("PYTHON"), PprofRuntime::Python),
            (Some("ruby"), PprofRuntime::Generic),
            (Some(""), PprofRuntime::Generic),
            (None, PprofRuntime::Generic),
        ] {
            assert_eq!(PprofRuntime::from_header(value), runtime, "{value:?}");
        }
    }

    #[test]
    fn pprof_validation_rejects() {
        let base = || {
            Fx::new()
                .sample_type("cpu", "nanoseconds")
                .func(1, "f", "")
                .loc(1, &[(1, 1)])
                .sample(&[1], &[3], &[])
        };
        let run = |fx: &Fx| {
            convert(
                "o",
                &fx.bytes(),
                &meta(PprofRuntime::Generic, None),
                &limits(),
            )
        };
        assert!(run(&base()).unwrap().is_some());

        type Edit = fn(&mut Fx);
        let cases: [(Edit, &str); 8] = [
            (
                |fx| fx.profile.sample_type[0].kind = 99,
                "outside string_table",
            ),
            (
                |fx| fx.profile.sample[0].value.push(1),
                "values for 1 sample types",
            ),
            (
                |fx| fx.profile.sample[0].location_id = vec![2],
                "unknown location 2",
            ),
            (
                |fx| fx.profile.location[0].line[0].function_id = 5,
                "unknown function 5",
            ),
            (
                |fx| fx.profile.function[0].id = 0,
                "function id must be non-zero",
            ),
            (
                |fx| fx.profile.function.push(fx.profile.function[0].clone()),
                "duplicate function id 1",
            ),
            (
                |fx| fx.profile.location.push(fx.profile.location[0].clone()),
                "duplicate location id 1",
            ),
            (
                |fx| {
                    let filename = fx.s("lib.so");
                    let mapping = PprofMapping {
                        id: 1,
                        memory_start: 1,
                        file_offset: 2,
                        filename,
                    };
                    fx.profile.mapping.push(mapping);
                    fx.profile.location[0].mapping_id = 1;
                    fx.profile.location[0].address = u64::MAX;
                    fx.profile.location[0].line.clear();
                },
                "overflows",
            ),
        ];
        for (edit, expected) in cases {
            let mut fx = base();
            edit(&mut fx);
            let message = invalid_message(run(&fx));
            assert!(message.contains(expected), "{expected}: {message}");
        }
    }

    #[test]
    fn size_limits_are_413() {
        // nodejs renders a frame per (function, line): over the distinct frame cap
        const LINES: usize = 64;
        let locations = (limits().max_frames / LINES) as u64 + 2;
        let mut fx =
            Fx::new()
                .sample_type("cpu", "nanoseconds")
                .func(1, "work", "/app/example-server/w.js");
        for id in 1..=locations {
            let lines: Vec<(u64, i64)> = (0..LINES as i64)
                .map(|i| (1, id as i64 * 100 + i))
                .collect();
            fx = fx.loc(id, &lines).sample(&[id], &[1], &[]);
        }
        let node = meta(PprofRuntime::NodeJs, Some(ROOT));
        assert_too_large(convert("o", &fx.bytes(), &node, &limits()));

        // more top-level records than the cap, checked before prost decodes them
        let over: Vec<u8> = std::iter::repeat_n([0x12_u8, 0x00], limits().max_samples + 1)
            .flatten()
            .collect();
        let generic = meta(PprofRuntime::Generic, None);
        assert_too_large(convert("o", &over, &generic, &limits()));
    }

    #[test]
    fn nested_entries_are_counted_on_the_wire() {
        let cap = PprofLimits {
            max_nested_entries: 4,
            ..limits()
        };
        // one length-delimited field (field 2 is a sample, 4 a location) of a short payload
        let field = |number: u8, payload: Vec<u8>| {
            [vec![(number << 3) | 2, payload.len() as u8], payload].concat()
        };
        // each shape with n entries
        let shapes = |n: usize| {
            // packed 2-byte location ids (300): an entry per byte without the continuation bit
            let packed = [vec![0x0a, 2 * n as u8], [0xac, 0x02].repeat(n)].concat();
            [
                ("packed ids", field(2, packed)),
                ("unpacked ids", field(2, [0x08, 0x01].repeat(n))),
                ("labels", field(2, [0x1a, 0x00].repeat(n))),
                ("location lines", field(4, [0x22, 0x00].repeat(n))),
            ]
        };
        for ((shape, at_cap), (_, over)) in shapes(4).into_iter().zip(shapes(5)) {
            let at_cap = precheck_counts(&at_cap, &cap);
            assert!(at_cap.is_ok(), "{shape}: {at_cap:?}");
            let over = precheck_counts(&over, &cap);
            let refused = matches!(over, Err(ProfilesExportError::PayloadTooLarge(_)));
            assert!(refused, "{shape}: {over:?}");
        }
        // a packed field claiming 5 bytes inside a sample that holds 1
        let truncated = precheck_counts(&field(2, vec![0x0a, 0x05, 0x01]), &cap);
        let malformed = matches!(truncated, Err(ProfilesExportError::InvalidArgument(_)));
        assert!(malformed, "{truncated:?}");
    }

    #[test]
    fn request_budgets_fold_the_tail_and_are_413_only_when_nothing_fits() {
        let org = "pprof_budget_org";
        let fx = stacks(&[80, 70, 60, 50, 40, 30, 20, 10]);
        let generic = meta(PprofRuntime::Generic, None);
        // 8 rows are over 4: the caps are halved until the tail folds into [other]
        let tight = PprofLimits {
            max_rows: 4,
            ..limits()
        };
        let request = convert(org, &fx.bytes(), &generic, &tight)
            .unwrap()
            .unwrap();
        let want = [("[other]", 210), ("fn1", 80), ("fn2", 70)];
        assert_eq!(
            rows_of(&request, "cpu"),
            want.map(|(s, v)| (s.to_string(), v))
        );
        let count = |org: &str, kind: &str, reason: &str| {
            let labels = [org, kind, reason];
            metrics::PROFILES_PPROF_FOLDED_ROWS
                .with_label_values(&labels)
                .get()
        };
        // the counters are rows of the pass that fit
        assert_eq!(
            (count(org, "cpu", "topn"), count(org, "cpu", "budget")),
            (6, 0)
        );

        // a single row is over a budget of one row, and no cap can shed it
        let one = PprofLimits {
            max_rows: 1,
            ..limits()
        };
        assert_too_large(convert(org, &fx.bytes(), &generic, &one));

        // linked rows of two types under stack-text pressure: the linked cap is halved to 1, so
        // trace b keeps its own [other] row and c and d join the unlinked one; totals hold
        let org = "pprof_link_budget_org";
        let frame = |id: u64| format!("{id}{}", "x".repeat(19));
        let mut fx = Fx::new()
            .sample_type("cpu", "nanoseconds")
            .sample_type("wall", "nanoseconds");
        let samples = [
            (1, 60, "a"),
            (2, 50, "b"),
            (3, 40, "c"),
            (4, 30, "d"),
            (5, 20, ""),
            (6, 10, ""),
        ];
        for (id, value, trace) in samples {
            let trace = trace.repeat(32);
            let label = [("trace_id", trace.as_str())];
            fx = fx.func(id, &frame(id), "").loc(id, &[(id, 1)]).sample(
                &[id],
                &[value, 2 * value],
                &label[..usize::from(!trace.is_empty())],
            );
        }
        // 20-byte frames: 240 bytes at the full caps, 148 once the linked cap is 1
        let squeezed = PprofLimits {
            max_stack_bytes: 150,
            ..limits()
        };
        let request = convert(org, &fx.bytes(), &generic, &squeezed)
            .unwrap()
            .unwrap();
        // (type, stack, trace_id, value), sorted
        let mut stored: Vec<_> = rows(&request)
            .iter()
            .map(|row| {
                let text = |key: &str| {
                    let text = row.get(key).and_then(json::Value::as_str);
                    text.unwrap_or("").to_string()
                };
                let value = row["value"].as_i64().unwrap();
                (text("profile_type"), text("stack"), text("trace_id"), value)
            })
            .collect();
        stored.sort();
        let mut want = Vec::new();
        for (kind, scale) in [("cpu", 1_i64), ("wall", 2)] {
            for (stack, trace, value) in [
                (frame(1), "a", 60),
                (frame(5), "", 20),
                (frame(6), "", 10),
                ("[other]".to_string(), "b", 50),
                ("[other]".to_string(), "", 70),
            ] {
                want.push((kind.to_string(), stack, trace.repeat(32), value * scale));
            }
            // per trace: a and b keep their totals, c and d move to the unlinked rows
            let total = |trace: &str| -> i64 {
                let trace = trace.repeat(32);
                let of_trace = |r: &&(String, String, String, i64)| r.0 == kind && r.2 == trace;
                stored.iter().filter(of_trace).map(|r| r.3).sum()
            };
            let totals = [total("a"), total("b"), total("")];
            assert_eq!(totals, [60, 50, 100].map(|v| v * scale), "{kind}");
            let folds = (count(org, kind, "topn"), count(org, kind, "unlinked"));
            assert_eq!(folds, (1, 2), "{kind}");
        }
        want.sort();
        assert_eq!(stored, want);

        // stacks past the depth limit keep 999 frames and the marker; once the frame budget is
        // spent a new stack folds into [other]: each is a unique leaf over 1,000 shared frames
        let org = "pprof_frame_budget_org";
        let mut fx = Fx::new().sample_type("cpu", "nanoseconds");
        for id in 1..=1000 {
            fx = fx.func(id, &format!("s{id}"), "").loc(id, &[(id, 1)]);
        }
        // the [other] stack spends one budget frame, so the last stack is refused
        let samples = MAX_TOTAL_STACK_FRAMES / MAX_STACK_DEPTH;
        for leaf in 1001..=1000 + samples as u64 {
            let ids: Vec<u64> = std::iter::once(leaf).chain(1..=1000).collect();
            fx = fx
                .func(leaf, &format!("l{leaf}"), "")
                .loc(leaf, &[(leaf, 1)])
                .sample(&ids, &[1], &[]);
        }
        let request = convert(org, &fx.bytes(), &generic, &limits())
            .unwrap()
            .unwrap();
        let cpu = rows_of(&request, "cpu");
        assert_eq!(cpu.len(), samples);
        assert_eq!(cpu.iter().map(|r| r.1).sum::<i64>(), samples as i64);
        assert!(cpu.contains(&("[other]".to_string(), 1)));
        assert!(cpu.iter().filter(|r| r.0 != "[other]").all(|(stack, _)| {
            stack.ends_with(TRUNCATED_ANCESTORS_NAME) && stack.split(';').count() == MAX_STACK_DEPTH
        }));
        assert_eq!(count(org, "cpu", "budget"), 1);
    }

    #[test]
    fn nodejs_frame_names_source_root_and_the_tail_keeping_cap() {
        for (file, expected) in [
            ("/app/example-server/a/b/x.js", "./a/b/x.js"),
            ("/app/example-server-evil/x.js", "example-server-evil/x.js"),
            ("/other/dir/deep/x.js", "deep/x.js"),
            ("file:///app/example-server/x.js", "./x.js"),
            (
                "node:internal/modules/cjs/loader",
                "node:internal/modules/cjs/loader",
            ),
        ] {
            assert_eq!(node_path(file, Some(ROOT)), expected, "{file}");
        }

        // one function at two lines is two frames for nodejs, one for generic
        let lines = Fx::new()
            .sample_type("cpu", "nanoseconds")
            .func(1, "work", "/app/example-server/src/x.js")
            .loc(1, &[(1, 10)])
            .loc(2, &[(1, 20)])
            .sample(&[1], &[5], &[])
            .sample(&[2], &[7], &[]);
        let node = rows_of(&lines.run(PprofRuntime::NodeJs), "cpu");
        let want = [("./src/x.js:work:10", 5), ("./src/x.js:work:20", 7)];
        assert_eq!(node, want.map(|(s, v)| (s.to_string(), v)));
        let generic = rows_of(&lines.run(PprofRuntime::Generic), "cpu");
        assert_eq!(generic, [("work".to_string(), 12)]);

        // a long frame keeps the tail of its path, its function name and its line
        let long_file = format!("/app/example-server/{}/x.js", "p".repeat(150));
        let fx = Fx::new()
            .sample_type("cpu", "nanoseconds")
            .func(1, &"n".repeat(150), &long_file)
            .loc(1, &[(1, 7)])
            .sample(&[1], &[4], &[]);
        let cpu = rows_of(&fx.run(PprofRuntime::NodeJs), "cpu");
        let tail = format!("/x.js:{}:7", "n".repeat(MAX_NODE_NAME_CHARS));
        assert_eq!(cpu[0].0.chars().count(), MAX_TEXT_CHARS);
        assert!(
            cpu[0].0.starts_with(ELLIPSIS) && cpu[0].0.ends_with(&tail),
            "{}",
            cpu[0].0
        );
    }

    #[test]
    fn python_frames_and_types_follow_the_nodejs_mapping() {
        // `<module>` and a dotted `co_qualname` survive; one function at two lines is two frames
        let fx = Fx::new()
            .sample_type("wall", "nanoseconds")
            .sample_type("space", "bytes")
            .sample_type("objects", "count")
            .sample_type("sample", "count")
            .func(1, "Class.method", "/app/example-server/pkg/mod.py")
            .func(2, "<module>", "/app/example-server/pkg/mod.py")
            .loc(1, &[(1, 42)])
            .loc(2, &[(1, 43)])
            .loc(3, &[(2, 1)])
            .sample(&[1, 3], &[5, 100, 2, 1], &[])
            .sample(&[2, 3], &[7, 200, 3, 1], &[]);
        let python = fx.run(PprofRuntime::Python);
        let want = [
            ("./pkg/mod.py:Class.method:42;./pkg/mod.py:<module>:1", 5),
            ("./pkg/mod.py:Class.method:43;./pkg/mod.py:<module>:1", 7),
        ];
        assert_eq!(
            rows_of(&python, "wall"),
            want.map(|(s, v)| (s.to_string(), v))
        );
        let mut kinds: Vec<String> = rows(&python)
            .iter()
            .map(|row| row["profile_type"].as_str().unwrap().to_string())
            .collect();
        kinds.sort();
        kinds.dedup();
        assert_eq!(kinds, ["inuse_objects", "inuse_space", "wall"]);
    }

    #[test]
    fn sanitiser_removes_markers_before_they_reach_the_dictionary_or_rows() {
        for (raw, filename, expected) in [
            ("eval at SECRET (/x.js?q#f)", false, "eval"),
            ("fn eval at SECRET", false, "fn eval"),
            ("(anonymous:L#1:C#1)", false, "(anonymous:L#1:C#1)"),
            ("/p/x.js?token=SECRET", true, "/p/x.js"),
            ("/p/x.js (SECRET)", true, "/p/x.js"),
            ("a;b\u{7}c\nd", false, "abcd"),
            ("eval\u{200B} at SECRET", false, "eval"),
            ("/x.js\u{2028}?SECRET", true, "/x.js"),
            ("a\u{202E}b\u{2029}c\u{FEFF}d\u{2066}e", false, "abcde"),
        ] {
            assert_eq!(sanitize(raw, filename), expected, "{raw:?}");
        }
        assert_eq!(sanitize(&"x".repeat(500), false).chars().count(), 200);

        let fx = Fx::new()
            .sample_type("cpu", "nanoseconds")
            .func(
                1,
                "eval at SECRETA (/z.js?SECRETB)",
                "/app/example-server/a.js?token=SECRETD",
            )
            .func(2, "plain;x\u{7}y", "/app/example-server/b.js (SECRETG)")
            .loc(1, &[(1, 1)])
            .loc(2, &[(2, 2)])
            .sample(&[1, 2], &[5], &[]);
        for (runtime, expected) in [
            (PprofRuntime::NodeJs, "./a.js:eval:1;./b.js:plainxy:2"),
            (PprofRuntime::Generic, "eval;plainxy"),
        ] {
            let request = fx.run(runtime);
            for text in &request.dictionary.as_ref().unwrap().string_table {
                assert!(!text.contains("SECRET") && !text.contains(';'), "{text}");
                assert!(!text.chars().any(char::is_control), "{text:?}");
            }
            assert_eq!(rows_of(&request, "cpu"), [(expected.to_string(), 5)]);
        }
    }

    #[test]
    fn trace_and_span_labels_link_cpu_and_wall_rows_only() {
        let trace = "0123456789abcdef0123456789abcdef";
        let span = "fedcba9876543210";
        // every case runs for nodejs and python, which must link identically
        let one_sample = |types: &[&str], values: &[i64], labels: &[(&str, &str)]| {
            let run = |runtime| {
                let mut fx = Fx::new();
                for kind in types {
                    fx = fx.sample_type(kind, "x");
                }
                let request = fx
                    .func(1, "f", "")
                    .loc(1, &[(1, 1)])
                    .sample(&[1], values, labels)
                    .run(runtime);
                let links = request.dictionary.as_ref().unwrap().link_table.clone();
                (links, rows(&request))
            };
            let node = run(PprofRuntime::NodeJs);
            assert_eq!(run(PprofRuntime::Python), node);
            node
        };

        let labels = [("trace_id", trace), ("span_id", span)];
        let (links, stored) = one_sample(&["cpu", "wall", "sample"], &[3, 4, 1], &labels);
        assert_eq!(links.len(), 2);
        assert_eq!(
            links[1].trace_id,
            [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef].repeat(2)
        );
        assert_eq!(
            links[1].span_id,
            [0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10]
        );
        for row in stored {
            let linked = matches!(row["profile_type"].as_str(), Some("cpu" | "wall"));
            assert_eq!(row.contains_key("trace_id"), linked, "{row:?}");
            assert!(!linked || (row["trace_id"] == trace && row["span_id"] == span));
        }

        // heap rows are never linked; an invalid id is dropped, with no link and no column
        let (links, stored) = one_sample(&["space"], &[8], &labels);
        assert!(links.len() == 1 && stored.iter().all(|r| !r.contains_key("trace_id")));
        for label in [
            ("trace_id", "0123456789ABCDEF0123456789ABCDEF"),
            ("trace_id", "0123456789abcdef0123456789abcde"),
            ("trace_id", "00000000000000000000000000000000"),
            ("trace_id", "0123456789abcdef0123456789abcdeg"),
            ("span_id", "0000000000000000"),
            ("span_id", trace),
        ] {
            let (links, stored) = one_sample(&["cpu"], &[3], &[label]);
            let none = |r: &json::Map<String, json::Value>| {
                !r.contains_key("trace_id") && !r.contains_key("span_id")
            };
            assert!(links.len() == 1 && stored.iter().all(none), "{label:?}");
        }
    }

    #[test]
    fn aggregation_top_n_and_per_link_other_fold_with_counters() {
        let count = |org: &str, reason: &str| {
            let labels = [org, "cpu", reason];
            metrics::PROFILES_PPROF_FOLDED_ROWS
                .with_label_values(&labels)
                .get()
        };
        let generic = meta(PprofRuntime::Generic, None);
        let text = |rows: &[(&str, i64)]| -> Vec<(String, i64)> {
            rows.iter().map(|(s, v)| (s.to_string(), *v)).collect()
        };

        // frames that sanitise alike, and one function at two locations, sum into one row
        let alike = Fx::new()
            .sample_type("cpu", "nanoseconds")
            .func(1, "a;b", "")
            .func(2, "ab", "")
            .loc(1, &[(1, 1)])
            .loc(2, &[(2, 1)])
            .loc(3, &[(2, 9)])
            .sample(&[1], &[3], &[])
            .sample(&[2], &[4], &[])
            .sample(&[3], &[5], &[]);
        assert_eq!(
            rows_of(&alike.run(PprofRuntime::Generic), "cpu"),
            text(&[("ab", 12)])
        );

        // top-N: the tail folds into one [other] row
        let org = "pprof_top_n_org";
        let cap = PprofLimits {
            max_stacks_per_type: 2,
            ..limits()
        };
        let fx = stacks(&[50, 40, 30, 20, 10]);
        let request = convert(org, &fx.bytes(), &generic, &cap).unwrap().unwrap();
        let want = text(&[("[other]", 60), ("fn1", 50), ("fn2", 40)]);
        assert_eq!(rows_of(&request, "cpu"), want);
        assert_eq!(count(org, "topn"), 3);

        // linked budget of one: trace a keeps its top row and folds its tail into one [other] row
        // with its link; links b and c are past the budget and join the unlinked [other]
        let org = "pprof_link_fold_org";
        let mut fx = Fx::new().sample_type("cpu", "nanoseconds");
        for (id, value, trace) in [(1, 100, 'a'), (2, 90, 'a'), (3, 50, 'b'), (4, 5, 'c')] {
            let trace = trace.to_string().repeat(32);
            fx = fx
                .func(id, &format!("fn{id}"), "")
                .loc(id, &[(id, 1)])
                .sample(&[id], &[value], &[("trace_id", trace.as_str())]);
        }
        let cap = PprofLimits {
            max_linked_rows_per_type: 1,
            ..limits()
        };
        let request = convert(org, &fx.bytes(), &generic, &cap).unwrap().unwrap();
        let linked = |has: bool| {
            let mut found: Vec<(String, i64, bool)> = rows(&request)
                .iter()
                .filter(|r| r.contains_key("trace_id") == has)
                .map(|r| {
                    (
                        r["stack"].as_str().unwrap().to_string(),
                        r["value"].as_i64().unwrap(),
                        has,
                    )
                })
                .collect();
            found.sort();
            found
        };
        assert_eq!(
            linked(true),
            [
                ("[other]".to_string(), 90, true),
                ("fn1".to_string(), 100, true)
            ]
        );
        assert_eq!(linked(false), [("[other]".to_string(), 55, false)]);
        assert_eq!((count(org, "topn"), count(org, "unlinked")), (1, 2));
    }

    #[test]
    fn a_location_with_more_inline_lines_than_the_depth_limit_is_cut_at_the_limit() {
        let lines: Vec<(u64, i64)> = (1..=3 * MAX_STACK_DEPTH as i64).map(|l| (1, l)).collect();
        let request = Fx::new()
            .sample_type("cpu", "nanoseconds")
            .func(1, "f", "")
            .func(2, "root", "")
            .loc(1, &lines)
            .loc(2, &[(2, 1)])
            .sample(&[1, 2], &[5], &[])
            .run(PprofRuntime::NodeJs);
        let rows = rows_of(&request, "cpu");
        assert_eq!(rows.len(), 1);
        let frames: Vec<&str> = rows[0].0.split(';').collect();
        assert_eq!(frames.len(), MAX_STACK_DEPTH);
        assert_eq!(
            frames
                .iter()
                .filter(|f| **f == TRUNCATED_ANCESTORS_NAME)
                .count(),
            1
        );
        assert!(!frames.iter().any(|f| f.contains("root")));
        assert_eq!(rows[0].1, 5);
    }

    #[test]
    fn idle_cpu_and_empty_heap_keep_one_zero_coverage_row_per_type() {
        let time = |values: &[i64]| {
            let fx = Fx::new()
                .sample_type("cpu", "nanoseconds")
                .sample_type("wall", "nanoseconds")
                .func(1, "f", "")
                .loc(1, &[(1, 1)]);
            fx.sample(&[1], values, &[]).run(PprofRuntime::NodeJs)
        };
        let zero = [(String::new(), 0)];
        let idle = time(&[0, 0]);
        assert_eq!(
            (rows_of(&idle, "cpu"), rows_of(&idle, "wall")),
            (zero.to_vec(), zero.to_vec())
        );
        let busy_wall = time(&[0, 9]);
        assert_eq!(rows_of(&busy_wall, "cpu"), zero);
        assert_eq!(rows_of(&busy_wall, "wall"), [("f".to_string(), 9)]);

        let heap = Fx::new()
            .sample_type("objects", "count")
            .sample_type("space", "bytes")
            .run(PprofRuntime::NodeJs);
        for kind in ["inuse_objects", "inuse_space"] {
            assert_eq!(rows_of(&heap, kind), zero);
        }
        assert!(rows(&heap).iter().all(|row| row["frame_count"] == 0));
    }
}
