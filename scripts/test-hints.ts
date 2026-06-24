/**
 * Fixture tests for `sameConcept` (hint diversity). Run: `npm run test:hints`.
 * Pure assertions — no test framework. Exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { sameConcept } from "../src/game/hints.js";

// Pairs that MUST be treated as the same concept (variants / spellings / plurals).
const MERGE: [string, string][] = [
  ["organisation", "organization"],
  ["gold", "golden"],
  ["magic", "magical"],
  ["magic", "magician"],
  ["magical", "magician"],
  ["fire", "fired"],
  ["launch", "launchers"],
  ["coast", "coastal"],
  ["coastal", "coastline"],
  ["cascade", "cascading"],
  ["eruption", "erupting"],
  ["medical", "medicine"],
  ["mountains", "mountainous"],
  ["astronomers", "astronomy"],
  ["bus", "buses"],
  ["house", "houses"],
  ["music", "musical"],
  ["rhino", "rhinoceros"],
  ["box", "boxes"],
  ["berry", "berries"],
];

// Pairs that MUST stay distinct (genuinely different words).
const KEEP: [string, string][] = [
  ["rat", "cat"],
  ["sunset", "sunshine"],
  ["cream", "bread"],
  ["tomato", "potato"],
  ["railway", "railroad"],
  ["nbc", "cnbc"],
  ["lime", "olive"],
  ["bass", "brass"],
  ["four", "hour"],
  ["gold", "golf"],
  ["car", "card"],
  ["venus", "venue"], // singular -us must not fold to a false prefix of "venue"
  ["basis", "basil"],
  ["oyster", "lobster"],
];

let failures = 0;
for (const [a, b] of MERGE) {
  try {
    assert.equal(sameConcept(a, b), true);
    assert.equal(sameConcept(b, a), true); // symmetric
  } catch {
    console.error(`FAIL (should merge): ${a} / ${b}`);
    failures++;
  }
}
for (const [a, b] of KEEP) {
  try {
    assert.equal(sameConcept(a, b), false);
    assert.equal(sameConcept(b, a), false);
  } catch {
    console.error(`FAIL (should stay distinct): ${a} / ${b}`);
    failures++;
  }
}

if (failures) {
  console.error(`\n${failures} sameConcept fixture(s) failed.`);
  process.exit(1);
}
console.log(`sameConcept: ${MERGE.length + KEEP.length} fixtures passed.`);
