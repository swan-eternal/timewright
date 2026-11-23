import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readImageSize } from "../src/core/images.js";

function svg(inner: string, attrs = ""): Uint8Array {
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg ${attrs}>\n${inner}\n</svg>`,
  );
}

describe("svg sizes", () => {
  it("reads the canvas size, not shapes inside the drawing", () => {
    // The shape of k1tesurfen's Middle-earth map: percent-sized svg with a
    // viewBox, and a frame rect whose width must not be mistaken for it.
    const file = svg(
      '<rect x="24.513" y="22.648" width="3150.97" height="2354.7" stroke-width="3"/>',
      'width="100%" height="100%" viewBox="0 0 13334 10000"',
    );
    assert.deepEqual(readImageSize(file), { width: 13334, height: 10000, format: "svg" });
  });

  it("falls back to the viewBox when the svg tag carries no size", () => {
    // Illustrator's export shape: no width/height at all, stroke-widths
    // everywhere. Only the viewBox answers.
    const file = svg(
      '<rect x="24.5" stroke="#000000" stroke-miterlimit="10" stroke-width="3" width="3151" height="2354.7"/>',
      'version="1.1" baseProfile="tiny" x="0px" y="0px" viewBox="0 0 3200 2400"',
    );
    assert.deepEqual(readImageSize(file), { width: 3200, height: 2400, format: "svg" });
  });

  it("understands physical units", () => {
    const a4 = svg("", 'width="210mm" height="297mm"');
    assert.deepEqual(readImageSize(a4), { width: 794, height: 1123, format: "svg" });
    const inches = svg("", 'width="8.5in" height="11in"');
    assert.deepEqual(readImageSize(inches), { width: 816, height: 1056, format: "svg" });
    const points = svg("", 'width="595.28pt" height="841.89pt"');
    assert.deepEqual(readImageSize(points), { width: 794, height: 1123, format: "svg" });
  });

  it("keeps reading plain pixel sizes, with or without the unit", () => {
    assert.deepEqual(readImageSize(svg("", 'width="800" height="600"')), {
      width: 800,
      height: 600,
      format: "svg",
    });
    assert.deepEqual(readImageSize(svg("", 'width="800px" height="600px"')), {
      width: 800,
      height: 600,
      format: "svg",
    });
  });

  it("skips a BOM and a DOCTYPE to find the root element", () => {
    const body = new TextEncoder().encode(
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg viewBox="0 0 100 50"></svg>',
    );
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
    assert.deepEqual(readImageSize(bom), { width: 100, height: 50, format: "svg" });
  });

  it("says nothing when no size is stated anywhere", () => {
    assert.equal(readImageSize(svg("", 'version="1.1"')), undefined);
  });
});
