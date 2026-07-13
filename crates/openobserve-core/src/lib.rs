// Copyright 2026 OpenObserve Inc.
//
// Core application services extracted from the production frontend crate.

#![recursion_limit = "256"]

#[cfg(feature = "enterprise")]
pub mod cipher;
pub mod common;
pub mod job;
pub mod service;

pub(crate) static USER_AGENT_REGEX_FILE: &[u8] = include_bytes!("../ua_regex/regexes.yaml");
