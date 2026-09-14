import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * MIGRATING WHATSAPP FROM EVOLUTION TO META
 *
 * The Meta transport was always implemented. What stopped a configured
 * deployment from using it was naming: WhatsApp, Instagram and the ad accounts
 * all hang off ONE Meta app, and this install supplied that app's credentials
 * as META_SYSTEM_USER_TOKEN and META_APP_SECRET — so the WHATSAPP_* getters
 * threw, `configStatus().whatsapp` read false, and the provider inference chose
 * Evolution, on an install that had everything Meta needed.
 *
 * The app secret case is the one that bites hardest: `verifySignature` fails
 * closed when it cannot read a secret, so the symptom is not an error. It is an
 * agent that accepts no inbound message at all.
 */

const KEYS = [
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_PROVIDER",
  "META_SYSTEM_USER_TOKEN", "META_APP_SECRET",
  "EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE",
  "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_VERIFY_TOKEN",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

/** Imported fresh each time: `env` reads process.env lazily, per access. */
async function envModule() {
  return import("../src/lib/osf/env");
}

describe("the Meta app's credentials are the WhatsApp credentials", () => {
  test("the access token falls back to META_SYSTEM_USER_TOKEN", async () => {
    const { env } = await envModule();
    process.env.META_SYSTEM_USER_TOKEN = "system-user-token";
    assert.equal(env.whatsappAccessToken, "system-user-token");
  });

  test("an explicit WHATSAPP_ACCESS_TOKEN still wins", async () => {
    const { env } = await envModule();
    process.env.META_SYSTEM_USER_TOKEN = "system-user-token";
    process.env.WHATSAPP_ACCESS_TOKEN = "messaging-only-token";
    assert.equal(env.whatsappAccessToken, "messaging-only-token");
  });

  test("the app secret falls back to META_APP_SECRET", async () => {
    const { env } = await envModule();
    process.env.META_APP_SECRET = "app-secret";
    assert.equal(env.whatsappAppSecret, "app-secret");
  });

  test("with neither name set it still refuses rather than guessing", async () => {
    const { env } = await envModule();
    assert.throws(() => env.whatsappAccessToken, /META_SYSTEM_USER_TOKEN/);
    assert.throws(() => env.whatsappAppSecret, /META_APP_SECRET/);
  });
});

describe("the webhook gate works on the resolved secret", () => {
  test("a body signed with META_APP_SECRET is accepted", async () => {
    process.env.META_APP_SECRET = "shared-app-secret";
    const { verifySignature } = await import("../src/lib/osf/whatsapp/verify");
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const sig = "sha256=" + crypto.createHmac("sha256", "shared-app-secret").update(body, "utf8").digest("hex");
    assert.equal(verifySignature(body, sig), true);
  });

  test("a forged signature is rejected", async () => {
    process.env.META_APP_SECRET = "shared-app-secret";
    const { verifySignature } = await import("../src/lib/osf/whatsapp/verify");
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    assert.equal(verifySignature(body, "sha256=" + "a".repeat(64)), false);
    assert.equal(verifySignature(body, null), false);
  });

  test("with no secret at all it fails closed, never open", async () => {
    const { verifySignature } = await import("../src/lib/osf/whatsapp/verify");
    const body = "{}";
    // Whatever signature is offered, an unconfigured secret must not accept it.
    const anything = "sha256=" + "b".repeat(64);
    assert.equal(verifySignature(body, anything), false);
  });
});

describe("the provider inference sees the token the sender will use", () => {
  test("Meta credentials under their Meta names still mean Meta", async () => {
    const { env } = await envModule();
    process.env.EVOLUTION_API_URL = "http://localhost:8080";
    process.env.META_SYSTEM_USER_TOKEN = "system-user-token";
    assert.equal(
      env.whatsappProvider,
      "meta",
      "an install with both present must not silently stay on the unofficial transport",
    );
  });

  test("Evolution alone still infers evolution", async () => {
    const { env } = await envModule();
    process.env.EVOLUTION_API_URL = "http://localhost:8080";
    assert.equal(env.whatsappProvider, "evolution");
  });

  test("an explicit setting always wins over inference", async () => {
    const { env } = await envModule();
    process.env.EVOLUTION_API_URL = "http://localhost:8080";
    process.env.META_SYSTEM_USER_TOKEN = "system-user-token";
    process.env.WHATSAPP_PROVIDER = "evolution";
    assert.equal(env.whatsappProvider, "evolution");
  });
});

describe("configStatus agrees with the getters", () => {
  test("WhatsApp reads configured when the Meta app supplies the values", async () => {
    const { configStatus } = await envModule();
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";
    process.env.META_SYSTEM_USER_TOKEN = "system-user-token";
    process.env.META_APP_SECRET = "app-secret";
    assert.equal(
      configStatus().whatsapp,
      true,
      "reporting 'not configured' here sends people hunting for a value they already supplied",
    );
  });

  test("a missing phone number id is still not configured", async () => {
    const { configStatus } = await envModule();
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";
    process.env.META_SYSTEM_USER_TOKEN = "system-user-token";
    process.env.META_APP_SECRET = "app-secret";
    assert.equal(configStatus().whatsapp, false);
  });
});
