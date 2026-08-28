import { describe, expect, it } from "vitest";
import { validateImportSettings } from "./routers/advanced";

describe("settings import validation", () => {
  it("accepts safe channel and profile settings without credentials", () => {
    const result = validateImportSettings({
      channels: [{ name: "Local Core", provider: "builtin", modelIds: ["Auto-select"], selectedModel: "Auto-select" }],
      profiles: [{ name: "Code Architect", temperature: 35, taskFocus: "development" }],
    });
    expect(result.channels[0].provider).toBe("builtin");
    expect(result.profiles?.[0].temperature).toBe(35);
  });

  it("rejects unsupported providers, empty models, and out-of-range temperature", () => {
    expect(() => validateImportSettings({ channels: [{ name: "Bad", provider: "unknown", modelIds: ["x"] }] })).toThrow();
    expect(() => validateImportSettings({ channels: [{ name: "Bad", provider: "builtin", modelIds: [] }] })).toThrow();
    expect(() => validateImportSettings({ channels: [{ name: "Good", provider: "builtin", modelIds: ["x"] }], profiles: [{ name: "Too hot", temperature: 101 }] })).toThrow();
  });
});


  it("strips credential-like unknown fields from imported settings", () => {
    const result = validateImportSettings({ channels: [{ name: "Safe", provider: "builtin", modelIds: ["Auto-select"], apiKey: "should-not-survive" }], profiles: [] });
    expect(JSON.stringify(result)).not.toContain("should-not-survive");
  });


  it("aggregates per-channel health and keeps empty channels visible", async () => {
    const { aggregateChannelHealth } = await import("./routers/advanced");
    const result = aggregateChannelHealth(
      [{ channelId: 1, latencyMs: 100, outcome: "success" }, { channelId: 1, latencyMs: 200, outcome: "error" }],
      [{ id: 1, name: "Core", connectionState: "online" }, { id: 2, name: "Backup", connectionState: "not_configured" }],
    );
    expect(result[0]).toMatchObject({ requests: 2, averageLatencyMs: 150, successRate: 50, errorRate: 50 });
    expect(result[1]).toMatchObject({ requests: 0, successRate: null, errorRate: null, connectionState: "not_configured" });
  });
