// Copyright 2026 OpenObserve Inc.
//
// Core application services extracted from the production frontend crate.

#![recursion_limit = "256"]

#[cfg(feature = "enterprise")]
#[path = "../../../src/cipher/mod.rs"]
pub mod cipher;
#[path = "../../../src/common/mod.rs"]
pub mod common;
#[path = "../../../src/service/mod.rs"]
pub mod service;

pub(crate) static USER_AGENT_REGEX_FILE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../ua_regex/regexes.yaml"
));
