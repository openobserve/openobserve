// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{any::Any, collections::BTreeMap, path::PathBuf, sync::Arc};

use dashmap::{DashMap, DashSet};
use hashbrown::{HashMap, HashSet};
use indexmap::IndexMap;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use crate::utils::schema_ext::SchemaExt;

const ARC_SIZE: usize = std::mem::size_of::<Arc<dyn Any>>();

/// Trait for getting cache statistics (async version)
/// Returns (len, capacity, memory_size_estimate)
pub trait CacheStatsAsync {
    fn stats(&self) -> impl std::future::Future<Output = (usize, usize, usize)> + Send;
}

/// Trait for getting cache statistics (sync version)
/// Returns (len, capacity, memory_size_estimate)
pub trait CacheStats {
    fn stats(&self) -> (usize, usize, usize);
}

pub trait MemorySize {
    fn mem_size(&self) -> usize;
}

// ============================================================================
// Memory size implementations
// ============================================================================

macro_rules! impl_memory_size_primitive {
    ($($t:ty),+) => {
        $(impl MemorySize for $t {
            fn mem_size(&self) -> usize {
                std::mem::size_of::<$t>()
            }
        })+
    };
}
impl_memory_size_primitive!(usize, u64, i64, i32, u8, bool, f64);

macro_rules! impl_memory_size_variable {
    ($($t:ty),+) => {
        $(impl MemorySize for $t {
            fn mem_size(&self) -> usize {
                std::mem::size_of::<$t>() + self.len()
            }
        })+
    };
}
impl_memory_size_variable!(String, &str, bytes::Bytes);

impl MemorySize for str {
    fn mem_size(&self) -> usize {
        self.len()
    }
}

impl MemorySize for PathBuf {
    fn mem_size(&self) -> usize {
        self.to_str().mem_size()
    }
}

impl MemorySize for svix_ksuid::Ksuid {
    fn mem_size(&self) -> usize {
        self.to_string().mem_size()
    }
}

impl MemorySize for arrow_schema::Schema {
    fn mem_size(&self) -> usize {
        self.size()
    }
}

impl<T: MemorySize + ?Sized> MemorySize for Arc<T> {
    fn mem_size(&self) -> usize {
        ARC_SIZE + self.as_ref().mem_size()
    }
}

impl<T: MemorySize + Sized> MemorySize for Option<T> {
    fn mem_size(&self) -> usize {
        self.as_ref().map(|v| v.mem_size()).unwrap_or(0)
    }
}

impl<V> MemorySize for Vec<V>
where
    V: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Vec<V>>() + self.iter().map(|v| v.mem_size()).sum::<usize>()
    }
}

impl<K, V> MemorySize for (K, V)
where
    K: MemorySize + Sized,
    V: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<(K, V)>() + self.0.mem_size() + self.1.mem_size()
    }
}

impl<K, V> MemorySize for HashMap<K, V>
where
    K: MemorySize + Sized,
    V: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<HashMap<K, V>>()
            + self
                .iter()
                .map(|(k, v)| k.mem_size() + v.mem_size())
                .sum::<usize>()
    }
}

impl<K> MemorySize for HashSet<K>
where
    K: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<HashSet<K>>() + self.iter().map(|k| k.mem_size()).sum::<usize>()
    }
}

impl<K, V> MemorySize for std::collections::HashMap<K, V>
where
    K: MemorySize + Sized,
    V: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<std::collections::HashMap<K, V>>()
            + self
                .iter()
                .map(|(k, v)| k.mem_size() + v.mem_size())
                .sum::<usize>()
    }
}

impl<K> MemorySize for std::collections::HashSet<K>
where
    K: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<std::collections::HashSet<K>>()
            + self.iter().map(|k| k.mem_size()).sum::<usize>()
    }
}

impl<K, V> MemorySize for std::collections::BTreeMap<K, V>
where
    K: MemorySize + Sized,
    V: MemorySize + Sized,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<std::collections::BTreeMap<K, V>>()
            + self
                .iter()
                .map(|(k, v)| k.mem_size() + v.mem_size())
                .sum::<usize>()
    }
}

impl<K, V, S> MemorySize for dashmap::DashMap<K, V, S>
where
    K: MemorySize + Sized + std::hash::Hash + Eq,
    V: MemorySize + Sized,
    S: std::hash::BuildHasher + Clone,
{
    fn mem_size(&self) -> usize {
        std::mem::size_of::<dashmap::DashMap<K, V, S>>()
            + self
                .iter()
                .map(|entry| entry.key().mem_size() + entry.value().mem_size())
                .sum::<usize>()
    }
}

// ============================================================================
// DashMap implementations (RwHashMap)
// ============================================================================

/// Implementation for DashMap with String keys
impl<V, S> CacheStats for DashMap<String, V, S>
where
    V: Sized + MemorySize,
    S: std::hash::BuildHasher + Clone,
{
    fn stats(&self) -> (usize, usize, usize) {
        let len = self.len();
        let cap = 0; // DashMap doesn't expose capacity
        let mem_size: usize = self
            .iter()
            .map(|entry| entry.key().mem_size() + entry.value().mem_size())
            .sum();
        (len, cap, mem_size)
    }
}

/// Implementation for DashMap with &str keys (fallback for any AsRef<str>)
impl<V, S> CacheStats for DashMap<&str, V, S>
where
    V: Sized + MemorySize,
    S: std::hash::BuildHasher + Clone,
{
    fn stats(&self) -> (usize, usize, usize) {
        let len = self.len();
        let cap = 0;
        let mem_size: usize = self
            .iter()
            .map(|entry| entry.key().mem_size() + entry.value().mem_size())
            .sum();
        (len, cap, mem_size)
    }
}

// ============================================================================
// DashSet implementations (RwHashSet)
// ============================================================================

/// Implementation for DashSet with String keys
impl<S> CacheStats for DashSet<String, S>
where
    S: std::hash::BuildHasher + Clone,
{
    fn stats(&self) -> (usize, usize, usize) {
        let len = self.len();
        let cap = 0; // DashSet doesn't expose capacity
        let mem_size: usize = self.iter().map(|entry| entry.key().mem_size()).sum();
        (len, cap, mem_size)
    }
}

// ============================================================================
// RwLock<HashMap> implementations (RwAHashMap)
// ============================================================================

/// Generic implementation for RwLock<HashMap<K, V>>
///
/// Note: For accurate String key memory tracking, use RwHashMap (DashMap) instead.
/// This implementation uses std::mem::size_of which only measures stack size.
/// For String keys, it misses heap allocations. For String values, it also misses
/// heap allocations. This is a known limitation of generic memory estimation.
impl<K, V, S> CacheStatsAsync for RwLock<HashMap<K, V, S>>
where
    K: Sized + Send + Sync + std::hash::Hash + Eq + MemorySize,
    V: Sized + Send + Sync + MemorySize,
    S: std::hash::BuildHasher + Send + Sync,
{
    async fn stats(&self) -> (usize, usize, usize) {
        let map = self.read().await;
        let len = map.len();
        let cap = map.capacity();
        // Note: This only accounts for stack size, not heap allocations
        let mem_size: usize = map.iter().map(|(k, v)| k.mem_size() + v.mem_size()).sum();
        (len, cap, mem_size)
    }
}

// ============================================================================
// RwLock<HashSet> implementations (RwAHashSet)
// ============================================================================

/// Implementation for RwLock<HashSet<String>>
impl CacheStatsAsync for RwLock<HashSet<String>> {
    async fn stats(&self) -> (usize, usize, usize) {
        let set = self.read().await;
        let len = set.len();
        let cap = set.capacity();
        let mem_size: usize = set.iter().map(|k| k.mem_size()).sum();
        (len, cap, mem_size)
    }
}

/// Implementation for RwLock<HashSet<PathBuf>>
impl CacheStatsAsync for RwLock<HashSet<PathBuf>> {
    async fn stats(&self) -> (usize, usize, usize) {
        let set = self.read().await;
        let len = set.len();
        let cap = set.capacity();
        let mem_size: usize = set.iter().map(|k| k.mem_size()).sum();
        (len, cap, mem_size)
    }
}

/// Implementation for HashSet<String>
impl CacheStats for HashSet<String> {
    fn stats(&self) -> (usize, usize, usize) {
        let len = self.len();
        let cap = self.capacity();
        let mem_size = std::mem::size_of::<HashSet<String>>()
            + self.iter().map(|k| k.mem_size()).sum::<usize>();

        (len, cap, mem_size)
    }
}

// ============================================================================
// RwLock<Vec> implementations
// ============================================================================

/// Implementation for RwLock<Vec<String>>
impl CacheStatsAsync for RwLock<Vec<String>> {
    async fn stats(&self) -> (usize, usize, usize) {
        let vec = self.read().await;
        let len = vec.len();
        let cap = vec.capacity();
        let mem_size: usize = vec.iter().map(|s| s.mem_size()).sum();
        (len, cap, mem_size)
    }
}

// ============================================================================
// RwLock<BTreeMap> implementations (RwBTreeMap)
// ============================================================================

/// Implementation for RwLock<BTreeMap<K, V>> where K can be displayed as string
impl<K, V> CacheStatsAsync for RwLock<BTreeMap<K, V>>
where
    K: Ord + Send + Sync + MemorySize,
    V: Sized + Send + Sync + MemorySize,
{
    async fn stats(&self) -> (usize, usize, usize) {
        let map = self.read().await;
        let len = map.len();
        let cap = 0; // BTreeMap doesn't have capacity
        let mem_size: usize = map.iter().map(|(k, v)| k.mem_size() + v.mem_size()).sum();
        (len, cap, mem_size)
    }
}

// ============================================================================
// RwLock<IndexMap> implementations (FxIndexMap wrapped in RwLock)
// ============================================================================

/// Implementation for RwLock<IndexMap<String, V>>
impl<V, S> CacheStatsAsync for RwLock<IndexMap<String, V, S>>
where
    V: Sized + Send + Sync + MemorySize,
    S: std::hash::BuildHasher + Send + Sync,
{
    async fn stats(&self) -> (usize, usize, usize) {
        let map = self.read().await;
        let len = map.len();
        let cap = map.capacity();
        let mem_size: usize = map.iter().map(|(k, v)| k.mem_size() + v.mem_size()).sum();
        (len, cap, mem_size)
    }
}

// ============================================================================
// Arc-wrapped implementations
// ============================================================================

/// Implementation for Arc<RwLock<HashMap<String, V>>>
impl<V> CacheStatsAsync for Arc<RwLock<HashMap<String, V>>>
where
    V: Sized + Send + Sync + MemorySize,
{
    async fn stats(&self) -> (usize, usize, usize) {
        self.as_ref().stats().await
    }
}

// ============================================================================
// Lazy wrapper implementations - allows calling .stats() on Lazy<Cache>
// ============================================================================

// Implementation for Lazy<T> where T implements CacheStatsSync
impl<T> CacheStats for Lazy<T>
where
    T: CacheStats,
{
    fn stats(&self) -> (usize, usize, usize) {
        (**self).stats()
    }
}

// Implementation for Lazy<T> where T implements CacheStats
impl<T> CacheStatsAsync for Lazy<T>
where
    T: CacheStatsAsync + Send + Sync,
{
    async fn stats(&self) -> (usize, usize, usize) {
        (**self).stats().await
    }
}

// ============================================================================
// Additional implementations for specific types
// ============================================================================

// Implementation for RwLock<IndexMap> with PathBuf keys (for IMMUTABLES)
impl<V, S> CacheStatsAsync for RwLock<IndexMap<PathBuf, V, S>>
where
    V: Sized + Send + Sync + MemorySize,
    S: std::hash::BuildHasher + Send + Sync + Default,
{
    async fn stats(&self) -> (usize, usize, usize) {
        let map = self.read().await;
        let len = map.len();
        let cap = map.capacity();
        let mem_size: usize = map.iter().map(|(k, v)| k.mem_size() + v.mem_size()).sum();
        (len, cap, mem_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================================
    // DashMap tests
    // ============================================================================

    #[test]
    fn test_dashmap_string_empty() {
        let map: DashMap<String, i32> = DashMap::new();
        let (len, _cap, mem_size) = map.stats();
        assert_eq!(len, 0);
        assert_eq!(mem_size, 0);
    }

    #[test]
    fn test_dashmap_string_with_data() {
        let map: DashMap<String, i32> = DashMap::new();
        map.insert("key1".to_string(), 42);
        map.insert("key2".to_string(), 100);

        let (len, _cap, mem_size) = map.stats();
        assert_eq!(len, 2);
        // mem_size: String heap data + String struct + value size for each entry
        assert_eq!(
            mem_size,
            4 + std::mem::size_of::<String>()
                + std::mem::size_of::<i32>()
                + 4
                + std::mem::size_of::<String>()
                + std::mem::size_of::<i32>()
        );
    }

    #[test]
    fn test_dashmap_str_with_data() {
        let map: DashMap<&str, i32> = DashMap::new();
        map.insert("key1", 42);
        map.insert("key2", 100);

        let (len, _cap, mem_size) = map.stats();
        assert_eq!(len, 2);
        assert_eq!(
            mem_size,
            4 + std::mem::size_of::<i32>() + 4 + std::mem::size_of::<i32>()
        );
    }

    // ============================================================================
    // DashSet tests
    // ============================================================================

    #[test]
    fn test_dashset_string_empty() {
        let set: DashSet<String> = DashSet::new();
        let (len, _cap, mem_size) = set.stats();
        assert_eq!(len, 0);
        assert_eq!(mem_size, 0);
    }

    #[test]
    fn test_dashset_string_with_data() {
        let set: DashSet<String> = DashSet::new();
        set.insert("key1".to_string());
        set.insert("key2".to_string());
        set.insert("longer_key".to_string());

        let (len, _cap, mem_size) = set.stats();
        assert_eq!(len, 3);
        assert_eq!(mem_size, 4 + 4 + 10); // "key1" + "key2" + "longer_key"
    }

    // ============================================================================
    // RwLock<HashMap> tests
    // ============================================================================

    #[tokio::test]
    async fn test_rwlock_hashmap_empty() {
        let map: RwLock<HashMap<String, i32>> = RwLock::new(HashMap::new());
        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 0);
        assert_eq!(mem_size, 0);
        assert_eq!(cap, 0);
    }

    #[tokio::test]
    async fn test_rwlock_hashmap_with_data() {
        let mut inner_map = HashMap::new();
        inner_map.insert("key1".to_string(), 42);
        inner_map.insert("key2".to_string(), 100);
        let map = RwLock::new(inner_map);

        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        // Note: Generic HashMap impl only counts stack size
        let expected_mem = (std::mem::size_of::<String>() + std::mem::size_of::<i32>()) * 2;
        assert_eq!(mem_size, expected_mem);
    }

    #[tokio::test]
    async fn test_rwlock_hashmap_generic_keys() {
        let mut inner_map = HashMap::new();
        inner_map.insert(1u64, "value1".to_string());
        inner_map.insert(2u64, "value2".to_string());
        let map = RwLock::new(inner_map);

        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        let expected_mem = (std::mem::size_of::<u64>() + std::mem::size_of::<String>()) * 2;
        assert_eq!(mem_size, expected_mem);
    }

    // ============================================================================
    // RwLock<HashSet> tests
    // ============================================================================

    #[tokio::test]
    async fn test_rwlock_hashset_string_empty() {
        let set: RwLock<HashSet<String>> = RwLock::new(HashSet::new());
        let (len, cap, mem_size) = set.stats().await;
        assert_eq!(len, 0);
        assert_eq!(cap, 0);
        assert_eq!(mem_size, 0);
    }

    #[tokio::test]
    async fn test_rwlock_hashset_string_with_data() {
        let mut inner_set = HashSet::new();
        inner_set.insert("key1".to_string());
        inner_set.insert("key2".to_string());
        let set = RwLock::new(inner_set);

        let (len, cap, mem_size) = set.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        assert_eq!(mem_size, 4 + 4); // "key1" + "key2"
    }

    #[tokio::test]
    async fn test_rwlock_hashset_pathbuf() {
        let mut inner_set = HashSet::new();
        inner_set.insert(PathBuf::from("/path/to/file1"));
        inner_set.insert(PathBuf::from("/path/to/file2"));
        let set = RwLock::new(inner_set);

        let (len, cap, mem_size) = set.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        assert_eq!(mem_size, "/path/to/file1".len() + "/path/to/file2".len());
    }

    // ============================================================================
    // RwLock<Vec> tests
    // ============================================================================

    #[tokio::test]
    async fn test_rwlock_vec_string_empty() {
        let vec: RwLock<Vec<String>> = RwLock::new(Vec::new());
        let (len, cap, mem_size) = vec.stats().await;
        assert_eq!(len, 0);
        assert_eq!(cap, 0);
        assert_eq!(mem_size, 0);
    }

    #[tokio::test]
    async fn test_rwlock_vec_string_with_data() {
        let inner_vec = vec!["hello".to_string(), "world".to_string()];
        let vec = RwLock::new(inner_vec);

        let (len, cap, mem_size) = vec.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        assert_eq!(mem_size, 5 + 5); // "hello" + "world"
    }

    // ============================================================================
    // RwLock<BTreeMap> tests
    // ============================================================================

    #[tokio::test]
    async fn test_rwlock_btreemap_empty() {
        let map: RwLock<BTreeMap<String, i32>> = RwLock::new(BTreeMap::new());
        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 0);
        assert_eq!(cap, 0); // BTreeMap doesn't have capacity
        assert_eq!(mem_size, 0);
    }

    #[tokio::test]
    async fn test_rwlock_btreemap_with_data() {
        let mut inner_map = BTreeMap::new();
        inner_map.insert("key1".to_string(), 42);
        inner_map.insert("key2".to_string(), 100);
        let map = RwLock::new(inner_map);

        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 2);
        assert_eq!(cap, 0); // BTreeMap doesn't have capacity
        let expected_mem = (4 + std::mem::size_of::<i32>()) + (4 + std::mem::size_of::<i32>());
        assert_eq!(mem_size, expected_mem);
    }

    // ============================================================================
    // RwLock<IndexMap> tests
    // ============================================================================

    #[tokio::test]
    async fn test_rwlock_indexmap_string_empty() {
        let map: RwLock<IndexMap<String, i32>> = RwLock::new(IndexMap::new());
        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 0);
        assert_eq!(cap, 0);
        assert_eq!(mem_size, 0);
    }

    #[tokio::test]
    async fn test_rwlock_indexmap_string_with_data() {
        let mut inner_map = IndexMap::new();
        inner_map.insert("key1".to_string(), 42);
        inner_map.insert("key2".to_string(), 100);
        let map = RwLock::new(inner_map);

        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        let expected_mem = (4 + std::mem::size_of::<i32>()) + (4 + std::mem::size_of::<i32>());
        assert_eq!(mem_size, expected_mem);
    }

    #[tokio::test]
    async fn test_rwlock_indexmap_pathbuf() {
        let mut inner_map: IndexMap<PathBuf, i32> = IndexMap::new();
        inner_map.insert(PathBuf::from("/path/file1"), 42);
        inner_map.insert(PathBuf::from("/path/file2"), 100);
        let map = RwLock::new(inner_map);

        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 2);
        assert!(cap >= 2);
        let expected_mem = ("/path/file1".len() + std::mem::size_of::<i32>())
            + ("/path/file2".len() + std::mem::size_of::<i32>());
        assert_eq!(mem_size, expected_mem);
    }

    // ============================================================================
    // Arc wrapper tests
    // ============================================================================

    #[tokio::test]
    async fn test_arc_rwlock_hashmap() {
        let mut inner_map = HashMap::new();
        inner_map.insert("key1".to_string(), 42);
        let map = Arc::new(RwLock::new(inner_map));

        let (len, cap, mem_size) = map.stats().await;
        assert_eq!(len, 1);
        assert!(cap >= 1);
        // Note: Generic HashMap impl only counts stack size
        let expected_mem = std::mem::size_of::<String>() + std::mem::size_of::<i32>();
        assert_eq!(mem_size, expected_mem);
    }

    // ============================================================================
    // Lazy wrapper tests
    // ============================================================================

    #[test]
    fn test_lazy_dashmap() {
        static CACHE: Lazy<DashMap<String, i32>> = Lazy::new(|| {
            let map = DashMap::new();
            map.insert("key1".to_string(), 42);
            map
        });

        let (len, _cap, mem_size) = CACHE.stats();
        assert_eq!(len, 1);
        assert_eq!(
            mem_size,
            4 + std::mem::size_of::<String>() + std::mem::size_of::<i32>()
        );
    }

    #[tokio::test]
    async fn test_lazy_rwlock_hashmap() {
        static CACHE: Lazy<RwLock<HashMap<String, i32>>> = Lazy::new(|| {
            let mut map = HashMap::new();
            map.insert("key1".to_string(), 42);
            RwLock::new(map)
        });

        let (len, cap, mem_size) = CACHE.stats().await;
        assert_eq!(len, 1);
        assert!(cap >= 1);
        // Note: Generic HashMap impl only counts stack size
        let expected_mem = std::mem::size_of::<String>() + std::mem::size_of::<i32>();
        assert_eq!(mem_size, expected_mem);
    }

    // ============================================================================
    // Memory size calculation accuracy tests
    // ============================================================================

    #[test]
    fn test_dashmap_string_memory_size_accuracy() {
        let map: DashMap<String, Vec<u8>> = DashMap::new();
        map.insert("short".to_string(), vec![1, 2, 3]);
        map.insert("a_longer_key".to_string(), vec![4, 5, 6, 7, 8]);

        let (len, _cap, mem_size) = map.stats();
        assert_eq!(len, 2);
        // String heap data + String struct + value size for each entry
        let expected = "short".len()
            + std::mem::size_of::<String>()
            + std::mem::size_of::<Vec<u8>>()
            + "a_longer_key".len()
            + std::mem::size_of::<String>()
            + std::mem::size_of::<Vec<u8>>();
        assert_eq!(mem_size, expected);
    }

    #[tokio::test]
    async fn test_rwlock_hashmap_memory_size_accuracy() {
        let mut inner_map = HashMap::new();
        inner_map.insert("key".to_string(), "value".to_string());
        let map = RwLock::new(inner_map);

        let (len, _cap, mem_size) = map.stats().await;
        assert_eq!(len, 1);
        // Note: Generic HashMap impl only counts stack size
        let expected = std::mem::size_of::<String>() + std::mem::size_of::<String>();
        assert_eq!(mem_size, expected);
    }
}
