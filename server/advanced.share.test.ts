import { describe, expect, it } from "vitest";
import { hashSharePassword } from "./routers/advanced";

describe("share password safety", () => {
  it("hashes with the share token so the plaintext never appears in the stored value", () => {
    const token = "share-token-1234567890";
    const password = "correct horse battery staple";
    const hash = hashSharePassword(token, password);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(password);
    expect(hashSharePassword(token, password)).toBe(hash);
    expect(hashSharePassword("different-token", password)).not.toBe(hash);
    expect(hashSharePassword(token, "different-password")).not.toBe(hash);
  });
});
