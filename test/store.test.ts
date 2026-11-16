import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Store, type AppState } from "../src/viewer/state.js";

function emptyState(): AppState {
  return {
    world: { title: "A world", maps: [], locations: [], people: [], events: [] },
    mapId: "europe",
    mode: "span",
  };
}

describe("the viewer's store", () => {
  it("tells its listeners when something changes", () => {
    const store = new Store(emptyState());
    let calls = 0;
    let lastChanged: string[] = [];
    store.subscribe((_state, changed) => {
      calls += 1;
      lastChanged = [...changed];
    });

    store.set({ mapId: "london" });
    assert.equal(calls, 1);
    assert.deepEqual(lastChanged, ["mapId"]);
  });

  it("still tells its listeners when nothing changed", () => {
    // A caller that sets a value to refresh the view should not have to
    // know whether it was already that value. This is what kept the first
    // render of the viewer from ever happening.
    const store = new Store(emptyState());
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.set({ mapId: "europe" });
    assert.equal(calls, 1);
  });

  it("reports an empty changed set when nothing differed", () => {
    const store = new Store(emptyState());
    let changed: string[] = ["untouched"];
    store.subscribe((_state, set) => {
      changed = [...set];
    });
    store.set({ mapId: "europe" });
    assert.deepEqual(changed, []);
  });
});
