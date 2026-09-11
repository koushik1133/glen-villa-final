import crypto from "node:crypto";
import { env } from "../env";

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body.
 *
 * Without this anybody who learns the webhook URL can POST fake customer
 * messages and drive the agent — and your Anthropic bill. The comparison is
 * constant-time to avoid leaking the expected digest byte by byte.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  /** Defaults to the WhatsApp app secret; Instagram passes its own. */
  secret?: string,
): boolean {
  if (!header) return false;

  const [algorithm, signature] = header.split("=");
  if (algorithm !== "sha256" || !signature) return false;

  // Buffer.from(..., "hex") stops at the first invalid pair rather than
  // throwing, so a malformed signature would silently decode short. Reject the
  // shape up front instead of relying on the length check below to catch it.
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;

  let expected: string;
  try {
    expected = crypto
      .createHmac("sha256", secret ?? env.whatsappAppSecret)
      .update(rawBody, "utf8")
      .digest("hex");
  } catch {
    // App secret not configured — fail closed.
    return false;
  }

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/** Constant-time string compare that doesn't leak length through timing. */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Hash first so both sides are always 32 bytes: timingSafeEqual throws on a
  // length mismatch, and returning early on that would leak the token length.
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Handles the GET handshake Meta performs when you first save the webhook URL.
 * Returns the challenge to echo back, or null to reject.
 */
export function verifyChallenge(
  params: URLSearchParams,
  /** Defaults to the WhatsApp verify token; Instagram passes its own. */
  expectedToken?: string,
): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode !== "subscribe" || !challenge || token === null) return null;

  try {
    // Verify token not configured — fail closed, same as the signature path.
    if (!timingSafeStringEqual(token, expectedToken ?? env.whatsappVerifyToken)) return null;
  } catch {
    return null;
  }

  return challenge;
}
