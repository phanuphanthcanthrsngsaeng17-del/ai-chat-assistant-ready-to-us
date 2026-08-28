import { describe, expect, it } from "vitest";
import { canCancelProcessing, processingStageLabels, resetProcessingStage } from "./progress";

describe("processing stage machine", () => {
  it("allows cancellation only while work is active", () => {
    expect(canCancelProcessing("thinking")).toBe(true);
    expect(canCancelProcessing("editing")).toBe(true);
    expect(canCancelProcessing("complete")).toBe(false);
    expect(canCancelProcessing("idle")).toBe(false);
  });

  it("resets terminal states while preserving active states", () => {
    expect(resetProcessingStage("complete")).toBe("idle");
    expect(resetProcessingStage("error")).toBe("idle");
    expect(resetProcessingStage("thinking")).toBe("thinking");
    expect(processingStageLabels.retrying).toContain("ลอง");
  });
});
