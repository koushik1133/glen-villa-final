import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * What the customer sent must survive.
 *
 * These lock in a defect that lost real messages: a photo, document or sticker
 * sent with NO caption produced no text, and both webhooks returned before
 * recording anything. The conversation record then disagreed with the
 * customer's own phone — the one place a dispute actually gets settled. Voice
 * notes were transcribed and the audio thrown away.
 */
describe("inbound customer media is kept, not discarded", () => {
  const EVOLUTION = "src/app/api/osf/evolution/route.ts";
  const META = "src/app/api/osf/whatsapp/route.ts";
  const CONVERSATION = "src/lib/osf/conversation.ts";
  const STORE = "src/lib/osf/whatsapp/inbound-media.ts";

  test("both webhooks give captionless media a body before the drop check", () => {
    for (const file of [EVOLUTION, META]) {
      const src = read(file);
      const describe = src.indexOf("describeMedia(");
      const drop = src.search(/if \(!text\) (return|continue);/);
      assert.notEqual(describe, -1, `${file} never calls describeMedia()`);
      assert.notEqual(drop, -1, `${file} has no drop check to guard`);
      assert.ok(
        describe < drop,
        `${file} drops the message before giving media a body — a captionless ` +
          `photo or document would never be recorded`,
      );
    }
  });

  test("both webhooks pass the file through to be stored", () => {
    for (const file of [EVOLUTION, META]) {
      assert.match(
        read(file),
        /\bmedia,/,
        `${file} does not hand the downloaded file to handleInbound`,
      );
    }
  });

  test("handleInbound records media_kind and media_url on the row", () => {
    const src = read(CONVERSATION);
    // media_kind goes through dbMediaKind(): the column is a Postgres enum of
    // OUTBOUND collateral kinds, and writing "audio" into it threw — which lost
    // the customer's voice note entirely rather than degrading.
    assert.match(src, /media_kind: dbMediaKind\(params\.media\.kind\)/);
    assert.match(src, /function dbMediaKind/);
    assert.match(src, /return kind === "image" \? "image" : "other";/);
    assert.match(src, /media_url: mediaPath/);
    // Both insert paths (with and without a wa_message_id) must carry it.
    const inserts = src.match(/role: "customer"/g) ?? [];
    const spreads = src.match(/\.\.\.mediaColumns/g) ?? [];
    assert.equal(
      spreads.length,
      inserts.length,
      "an insert path records the customer message without its media",
    );
  });

  test("a message the agent stays silent on is still recorded", () => {
    const src = read(CONVERSATION);
    // The reply:false branch must sit AFTER the insert, or silence would again
    // mean the message was never stored.
    const insert = src.indexOf('role: "customer"');
    const silent = src.indexOf('params.reply === false');
    assert.notEqual(silent, -1, "no reply:false branch — silence still drops the message");
    assert.ok(insert < silent, "the silence check runs before the message is recorded");
  });

  test("the media bucket is private", () => {
    const src = read(STORE);
    assert.match(src, /INBOUND_BUCKET = "inbound-media"/);
    // A signed URL is the only read path; a public URL would expose every
    // customer's identity documents to anyone who guessed the object name.
    assert.match(src, /createSignedUrl/);
    assert.doesNotMatch(src, /getPublicUrl/);
  });

  test("the read route checks a permission before signing", () => {
    const src = read("src/app/api/osf/media/[...path]/route.ts");
    const guard = src.indexOf("await guard(");
    const sign = src.indexOf("signInboundMedia(");
    assert.notEqual(guard, -1, "media can be read with no permission check");
    assert.ok(guard < sign, "the URL is signed before the permission is checked");
    assert.match(src, /includes\("\.\."\)/, "no path-traversal rejection");
  });

  test("an upload failure loses the file, never the message", () => {
    const src = read(STORE);
    assert.match(
      src,
      /return null;/,
      "storeInboundMedia must return null on failure rather than throw — " +
        "throwing would abort the insert and lose the message too",
    );
  });
});
