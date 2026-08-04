import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as whatsappPost, GET as whatsappGet } from "./whatsapp/route";
import { requiredWebhookSecret } from "@/lib/bots/shared";

/**
 * Both bot webhooks are public URLs. The shared secret is the only thing
 * separating a real update from one anybody can forge, and a forged update
 * queues attacker-supplied PDFs, spends model budget, and makes our own number
 * send messages to recipients an attacker chooses.
 *
 * These drive the route handlers rather than the verifying helper, because the
 * bug this guards against was never in the helper — it was a call site that
 * verified only `if (appSecret)`, so an unset variable skipped the check
 * entirely while everything still looked healthy.
 */

const ENV_KEYS = ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function signedRequest(body: string, secret: string): Request {
  return new Request("https://x/api/bots/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
    body,
  });
}

describe("requiredWebhookSecret", () => {
  it("refuses an unset or empty secret rather than treating it as 'no check'", () => {
    delete process.env.TEST_WEBHOOK_SECRET;
    expect(() => requiredWebhookSecret("TEST_WEBHOOK_SECRET")).toThrow(/is not set/);

    process.env.TEST_WEBHOOK_SECRET = "";
    expect(() => requiredWebhookSecret("TEST_WEBHOOK_SECRET")).toThrow(/is not set/);

    process.env.TEST_WEBHOOK_SECRET = "s3cret";
    expect(requiredWebhookSecret("TEST_WEBHOOK_SECRET")).toBe("s3cret");
    delete process.env.TEST_WEBHOOK_SECRET;
  });
});

describe("WhatsApp webhook authentication", () => {
  const body = '{"entry":[]}';

  it("refuses to serve at all when the app secret is unset", async () => {
    delete process.env.WHATSAPP_APP_SECRET;

    // Not 200. An unconfigured webhook must fail loudly, not accept anything
    // that arrives — this is the case the old `if (appSecret)` let through.
    const response = await whatsappPost(signedRequest(body, "anything"));

    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/WHATSAPP_APP_SECRET/);
  });

  it("rejects an unsigned body when the secret is set", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";

    const response = await whatsappPost(
      new Request("https://x/api/bots/whatsapp", { method: "POST", body }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a body signed with the wrong secret", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";

    const response = await whatsappPost(signedRequest(body, "not-the-secret"));

    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed body", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";

    const response = await whatsappPost(signedRequest(body, "app-secret"));

    expect(response.status).toBe(200);
  });
});

describe("WhatsApp verification handshake", () => {
  function challenge(token: string): Request {
    return new Request(
      `https://x/api/bots/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=echo-me`,
    );
  }

  it("does not echo the challenge when no verify token is configured", () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;

    // Otherwise anyone could point their own Meta app at this URL and start
    // delivering webhooks to it.
    expect(whatsappGet(challenge("")).status).toBe(403);
    expect(whatsappGet(challenge("guess")).status).toBe(403);
  });

  it("echoes the challenge only for the configured token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";

    expect(whatsappGet(challenge("wrong")).status).toBe(403);

    const ok = whatsappGet(challenge("verify-me"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("echo-me");
  });
});
