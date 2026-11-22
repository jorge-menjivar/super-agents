import { getAuthJwtSecret } from '@api/constants';
import type { AppContext } from '@api/types/hono';

/**
 * Whether a request is a review the gateway itself sent.
 *
 * A review is never itself reviewed, and never makes its reviewer a new
 * skill, so the request the gateway sends a reviewer says it is one:
 * `reviewing_trace_id` names the request under review. But the gateway's own
 * calls and its clients' use the same bearer token, and a client could send
 * that field too -- and with it switch off its agent's reviewer, fail-closed
 * or not. So the gateway signs it: `reviewing_signature` is an HMAC of the
 * trace id under `AUTH_JWT_SECRET`, which never leaves the server, and only a
 * request whose signature checks out is treated as a review.
 *
 * Production requires that secret. In development it falls back to a value
 * anyone can read, so there the signature keeps out accidents, not a client
 * that sets out to forge one.
 */

const encoder = new TextEncoder();

/** What is signed: the trace id, under a purpose of its own. */
const signedText = (traceId: string) => `review:${traceId}`;

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

const fromHex = (hex: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

/**
 * The HMAC key, imported per call: on Workers there is no environment until
 * a request arrives, so nothing can be prepared at module load.
 */
const keyFor = (c: AppContext) =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(getAuthJwtSecret(c)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

/** The signature the gateway gives the review of the request `traceId`. */
export async function signReview(
  c: AppContext,
  traceId: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await keyFor(c),
    encoder.encode(signedText(traceId)),
  );
  return toHex(signature);
}

/**
 * Whether the configuration is a review the gateway signed. A trace id
 * without a valid signature is a client's claim, and is ignored.
 */
export async function isSignedReview(
  c: AppContext,
  config: { reviewing_trace_id?: string; reviewing_signature?: string },
): Promise<boolean> {
  const { reviewing_trace_id: traceId, reviewing_signature: signature } =
    config;
  if (!traceId || !signature) {
    return false;
  }
  const bytes = fromHex(signature);
  if (!bytes) {
    return false;
  }
  // `verify` compares in constant time, so the check leaks nothing about
  // how close a forged signature came.
  return crypto.subtle.verify(
    'HMAC',
    await keyFor(c),
    bytes,
    encoder.encode(signedText(traceId)),
  );
}
