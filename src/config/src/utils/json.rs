// Copyright 2023 Zinc Labs Inc.
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
