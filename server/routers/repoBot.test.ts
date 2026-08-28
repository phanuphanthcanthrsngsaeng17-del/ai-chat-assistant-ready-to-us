import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  decodeBase64,
  inspectZip,
  isSafeFilePath,
  makeDiff,
  parseGitUrl,
  REPO_MAX_ARCHIVE_BYTES,
  REPOSITORY_SAFETY_INSTRUCTION,
} from "./repoBot";

describe("repo bot safety rules", () => {
  it("rejects unsafe source paths before indexing or exporting", () => {
    expect(isSafeFilePath("src/App.tsx")).toBe(true);
    expect(isSafeFilePath("../secrets.env")).toBe(false);
    expect(isSafeFilePath(".git/config")).toBe(false);
    expect(isSafeFilePath("src/node_modules/pkg/index.js")).toBe(false);
    expect(isSafeFilePath("src/../secret.ts")).toBe(false);
  });

  it("accepts only HTTPS URLs for known public repository hosts", () => {
    expect(parseGitUrl("https://github.com/silelo/demo")).toEqual({ platform: "github", owner: "silelo", repo: "demo" });
    expect(() => parseGitUrl("http://github.com/silelo/demo")).toThrow("HTTPS");
    expect(() => parseGitUrl("https://example.com/silelo/demo")).toThrow("GitHub และ GitLab");
    expect(() => parseGitUrl("not-a-url")).toThrow("HTTPS");
  });

  it("rejects oversize archives and protected entries contained in ZIP files", async () => {
    const oversize = Buffer.alloc(REPO_MAX_ARCHIVE_BYTES + 1).toString("base64");
    expect(() => decodeBase64(`data:application/zip;base64,${oversize}`)).toThrow("ไม่เกิน 50 MB");
    const zip = new JSZip();
    zip.file(".git/config", "[core]\nrepositoryformatversion = 0");
    const archive = await zip.generateAsync({ type: "nodebuffer" });
    await expect(inspectZip(archive)).rejects.toThrow("เส้นทางไฟล์ที่ไม่อนุญาต");
  });

  it("creates a reviewable unified diff and never performs git mutations", () => {
    const output = makeDiff({ textFiles: { "src/App.tsx": "const title = 'old';\n" } } as Parameters<typeof makeDiff>[0], [{
      path: "src/App.tsx",
      action: "update",
      explanation: "rename title",
      content: "const title = 'new';\n",
    }]);
    expect(output).toContain("-const title = 'old';");
    expect(output).toContain("+const title = 'new';");
    expect(REPOSITORY_SAFETY_INSTRUCTION).toContain("ห้ามเสนอหรือเรียกใช้ git token, commit, push");
  });
});
