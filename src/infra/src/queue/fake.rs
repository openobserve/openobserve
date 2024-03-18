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

use async_trait::async_trait;
use bytes::Bytes;

use crate::errors::*;

pub async fn init() -> Result<()> {
    Ok(())
}

pub struct FakeQueue {}

impl FakeQueue {
    pub fn new(_prefix: &str) -> Self {
        Self {}
    }

    pub fn super_cluster() -> Self {
        Self::new("")
    }
}

impl Default for FakeQueue {
    fn default() -> Self {
        Self::new("")
    }
}

#[async_trait]
impl super::Queue for FakeQueue {
    async fn create(&self, _topic: &str) -> Result<()> {
        todo!()
    }

    async fn publish(&self, _topic: &str, _value: Bytes) -> Result<()> {
        todo!()
    }

    async fn sub(&self, _topic: &str) -> Result<Bytes> {
        todo!()
    }

    async fn purge(&self, _topic: &str, _sequence: usize) -> Result<()> {
        todo!()
    }
}
