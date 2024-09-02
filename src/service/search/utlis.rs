// Copyright 2024 Zinc Labs Inc.
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

use std::{future::Future, pin::Pin, sync::Arc};

use tokio::sync::Mutex;

type Cleanup = Pin<Box<dyn Future<Output = ()> + Send>>;

/// A utility for running an asynchronous cleanup function when a value is dropped.
pub struct AsyncDefer {
    cleanup: Option<Arc<Mutex<Cleanup>>>,
}

impl AsyncDefer {
    pub fn new<F>(cleanup: F) -> Self
    where
        F: Future<Output = ()> + Send + 'static,
    {
        AsyncDefer {
            cleanup: Some(Arc::new(Mutex::new(Box::pin(cleanup)))),
        }
    }
}

impl Drop for AsyncDefer {
    fn drop(&mut self) {
        if let Some(cleanup) = self.cleanup.take() {
            tokio::spawn(async move {
                let mut cleanup = cleanup.lock().await;
                cleanup.as_mut().await;
            });
        }
    }
}
