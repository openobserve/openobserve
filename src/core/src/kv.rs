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

use crate::db::kv;

pub async fn get(org_id: &str, key: &str) -> Result<bytes::Bytes, anyhow::Error> {
    let val = kv::get(org_id, key).await?;
    Ok(val)
}

pub async fn set(org_id: &str, key: &str, val: bytes::Bytes) -> Result<(), anyhow::Error> {
    kv::set(org_id, key, val).await?;
    Ok(())
}

pub async fn compare_and_set(
    org_id: &str,
    key: &str,
    expected: Option<&[u8]>,
    val: bytes::Bytes,
) -> Result<bool, anyhow::Error> {
    kv::compare_and_set(org_id, key, expected, val).await
}

#[cfg(feature = "enterprise")]
pub async fn compare_and_delete(
    org_id: &str,
    key: &str,
    expected: &[u8],
) -> Result<bool, anyhow::Error> {
    kv::compare_and_delete(org_id, key, expected).await
}

#[cfg(feature = "enterprise")]
pub async fn compare_and_mutate_guarded(
    org_id: &str,
    key: &str,
    expected: Option<&[u8]>,
    value: Option<Vec<u8>>,
    guard_key: &str,
    guard: &[u8],
) -> Result<bool, anyhow::Error> {
    kv::compare_and_mutate_guarded(
        org_id,
        key,
        expected,
        value.map(bytes::Bytes::from),
        guard_key,
        guard,
    )
    .await
}

pub async fn compare_and_delete_in_region(
    org_id: &str,
    key: &str,
    expected: &[u8],
) -> Result<bool, anyhow::Error> {
    kv::compare_and_delete_in_region(org_id, key, expected).await
}

pub async fn delete(org_id: &str, key: &str) -> Result<(), anyhow::Error> {
    kv::delete(org_id, key).await?;
    Ok(())
}

pub async fn list(org_id: &str, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
    let items = kv::list_keys(org_id, prefix).await?;
    Ok(items)
}
