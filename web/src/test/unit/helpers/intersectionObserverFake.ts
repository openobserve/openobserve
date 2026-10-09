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

interface Observed {
  callback: IntersectionObserverCallback;
  targets: Set<Element>;
}

/** An IntersectionObserver whose visibility the spec drives per element; the setup mock never fires. */
export function installFakeIntersectionObserver({ autoVisible = false } = {}) {
  const original = globalThis.IntersectionObserver;
  const observers = new Set<Observed>();

  const notify = (entry: Observed, target: Element, isIntersecting: boolean) =>
    entry.callback([{ target, isIntersecting } as IntersectionObserverEntry], {} as any);

  class FakeIntersectionObserver {
    private entry: Observed;
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
      if (autoVisible) notify(this.entry, target, true);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      observers.delete(this.entry);
    }
    takeRecords() {
      return [];
    }
  }

  globalThis.IntersectionObserver = FakeIntersectionObserver as any;

  return {
    setVisible(target: Element, isIntersecting: boolean) {
      for (const entry of observers) {
        if (entry.targets.has(target)) notify(entry, target, isIntersecting);
      }
    },
    restore() {
      globalThis.IntersectionObserver = original;
    },
  };
}
