// Copyright 2025 OpenObserve Inc.
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

use hashbrown::HashMap;
use o2_enterprise::enterprise::cipher::Cipher;
use once_cell::sync::Lazy;
use parking_lot::RwLock;

pub static REGISTRY: Lazy<RwLock<Registry>> = Lazy::new(|| RwLock::new(Registry::new()));
pub struct Registry {
    keys: HashMap<String, Box<dyn Cipher>>,
}

impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

impl Registry {
    pub fn new() -> Self {
        Self {
            keys: Default::default(),
        }
    }
    pub fn new_with_keys(keys: HashMap<String, Box<dyn Cipher>>) -> Self {
        Self { keys }
    }
    pub fn add_key(&mut self, name: String, k: Box<dyn Cipher>) {
        self.keys.insert(name, k);
    }
    pub fn get_key(&self, name: &str) -> Option<Box<dyn Cipher>> {
        self.keys.get(name).map(|k| k.clone_self())
    }
    pub fn remove_key(&mut self, name: &str) {
        self.keys.remove(name);
    }
}
