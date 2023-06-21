// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pub use serde_json::{from_value, json, to_value, Error, Map, Number, Value};

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn to_string<T>(value: &T) -> Result<String, simd_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    simd_json::to_string(value)
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn to_vec<T>(value: &T) -> Result<Vec<u8>, simd_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    simd_json::to_vec(value)
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn from_str<'a, T>(s: &'a str) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    from_slice(s.as_bytes())
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn from_slice<'a, T>(v: &'a [u8]) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    serde_json::from_slice(v)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn to_string<T>(value: &T) -> Result<String, serde_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    serde_json::to_string(value)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn to_vec<T>(value: &T) -> Result<Vec<u8>, serde_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    serde_json::to_vec(value)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn from_str<'a, T>(s: &'a str) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    from_slice(s.as_bytes())
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn from_slice<'a, T>(v: &'a [u8]) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    serde_json::from_slice(v)
}
