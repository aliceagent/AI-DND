/** Gate: Prep Bench server wiring. Drafts load from the pack dir, the
 *  review persists beside them (originals untouched, approval explicit),
 *  and only the host token opens the door. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDrafts, saveReviewed, benchAuthorized } from "../src/bench.js";
import { Engine } from "../../../engine/src/engine.js";
import { SessionHub, type ClientConn } from "../src/hub.js";
import { EchoDM } from "../src/dm.js";
import { MockMediaService } from "../src/media.js";

class FakeConn implements ClientConn {
  messages: any[] = [];
  send(msg: unknown): void { this.messages.push(msg); }
  last(t: string): any { return this.messages.filter(m => m.type === t).at(-1); }
}

test("drafts load, review saves beside them, originals untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermys-bench-"));
  try {
    const beats = [{ id: "e1.a", approved: false }, { id: "e1.b", approved: false }];
    writeFileSync(join(dir, "beats.json"), JSON.stringify(beats));
    writeFileSync(join(dir, "entities.json"), JSON.stringify([{ id: "loc.x" }]));
    const drafts = loadDrafts(dir);
    assert.equal(drafts.beats.length, 2);
    assert.equal(drafts.entities.length, 1);

    drafts.beats[0].approved = true;
    const out = saveReviewed(dir, drafts);
    assert.deepEqual(out, { beats: 2, entities: 1, approved: 1 });
    const reviewed = JSON.parse(readFileSync(join(dir, "reviewed.json"), "utf8"));
    assert.equal(reviewed.beats[0].approved, true);
    // the originals are still the unapproved drafts
    assert.equal(JSON.parse(readFileSync(join(dir, "beats.json"), "utf8"))[0].approved, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("review validation: implicit approval and shapeless payloads are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermys-bench-"));
  try {
    assert.throws(() => saveReviewed(dir, { beats: [{ id: "x" }], entities: [] }), /explicit/);
    assert.throws(() => saveReviewed(dir, { beats: "nope" }), /beats\[\]/);
    assert.ok(!existsSync(join(dir, "reviewed.json")), "refused review must not write");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the token gate: empty, wrong, and missing all fail; only the host receives it", () => {
  assert.equal(benchAuthorized(undefined, "tok"), false);
  assert.equal(benchAuthorized("", "tok"), false);
  assert.equal(benchAuthorized("wrong", "tok"), false);
  assert.equal(benchAuthorized("tok", "tok"), true);

  const engine = new Engine(90);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService(), undefined, "tok");
  const host = new FakeConn(), screen = new FakeConn();
  hub.join("h", host, { role: "host" });
  hub.join("s", screen, { role: "screen" });
  assert.equal(host.last("joined").benchToken, "tok");
  assert.equal(screen.last("joined").benchToken, undefined, "token leaked to a non-host");
});
