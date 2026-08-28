export const processingStages = ["idle", "queued", "thinking", "analyzing", "editing", "retrying", "complete", "error"] as const;
export type ProcessingStage = typeof processingStages[number];

export const processingStageLabels: Record<Exclude<ProcessingStage, "idle">, string> = {
  queued: "เข้าคิวคำสั่ง…",
  thinking: "กำลังคิด…",
  analyzing: "กำลังวิเคราะห์ไฟล์…",
  editing: "กำลังแก้โค้ด…",
  retrying: "ลองวิธีนี้ดู…",
  complete: "เรียบร้อย · พร้อมตรวจ diff",
  error: "ยังไม่เสร็จ · ลองใหม่ได้",
};

export function resetProcessingStage(stage: ProcessingStage): ProcessingStage {
  return stage === "complete" || stage === "error" || stage === "retrying" ? "idle" : stage;
}

export function canCancelProcessing(stage: ProcessingStage) {
  return ["queued", "thinking", "analyzing", "editing", "retrying"].includes(stage);
}
