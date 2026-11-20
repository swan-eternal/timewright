import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readLink, writeLink } from "../src/viewer/link.js";

describe("deep links", () => {
  it("round-trips a whole view", () => {
    const link = writeLink({
      map: "london",
      date: "1815-06-18",
      span: "1812..1815",
      trace: "napoleon",
      traces: "napoleon,wellington",
      event: "waterloo",
      query: "water",
    });
    assert.match(link, /^#/);
    assert.deepEqual(readLink(link), {
      map: "london",
      date: "1815-06-18",
      span: "1812..1815",
      trace: "napoleon",
      traces: "napoleon,wellington",
      event: "waterloo",
      query: "water",
    });
  });

  it("reads a link without a hash", () => {
    assert.deepEqual(readLink("map=europe&date=1800"), { map: "europe", date: "1800" });
  });

  it("ignores what it does not know", () => {
    assert.deepEqual(readLink("#map=europe&colour=blue"), { map: "europe" });
  });

  it("has nothing to say about an empty view", () => {
    assert.equal(writeLink({}), "");
  });
});
