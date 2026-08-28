import { createTwoFilesPatch } from "diff";
import JSZip from "jszip";
import { z } from "zod";
import {
  createArtifact,
  createAiTrace,
  createChangeRequest,
  createMessage,
  createProject,
  getChangeForUser,
  getProjectForUser,
  listArtifactsForProject,
  listChangesForProject,
  listMessagesForProject,
  listProjectsForUser,
  markChangeExported,
  ProposalFile,
  ProjectFileIndexEntry,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { protectedProcedure, router } from "../_core/trpc";
import { storageGetSignedUrl, storagePut } from "../storage";

export const REPO_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 400;
const MAX_FILE_TEXT_BYTES = 48 * 1024;
const MAX_PROPOSAL_FILES = 8;
const MAX_PROPOSAL_TEXT_BYTES = 180 * 1024;
export const REPOSITORY_SAFETY_INSTRUCTION = "คุณเป็นผู้ช่วยวางข้อเสนอแก้โค้ดระดับมืออาชีพ ทำงานเฉพาะกับสำเนาโครงการที่ให้มา ห้ามเสนอหรือเรียกใช้ git token, commit, push, pull request, remote command หรือการเชื่อมต่อ repository ใด ๆ ให้ตอบเป็น JSON ตาม schema เท่านั้น สำหรับไฟล์ที่แก้หรือสร้าง ต้องส่งเนื้อหาไฟล์ฉบับเต็มใน content จำกัดไม่เกิน 8 ไฟล์ อธิบายการเปลี่ยนแปลงเป็นภาษาไทย กระชับ และอย่าแก้ไฟล์ไบนารีหรือ .git/node_modules";

type ProjectSnapshot = {
  zip: JSZip;
  entries: ProjectFileIndexEntry[];
  textFiles: Record<string, string>;
};

type LlmProposal = {
  summary: string;
  analysis: string;
  changes: ProposalFile[];
};

export function decodeBase64(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:application\/(zip|x-zip-compressed);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("โปรดอัปโหลดไฟล์ ZIP ที่ถูกต้อง");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > REPO_MAX_ARCHIVE_BYTES) {
    throw new Error("ไฟล์ ZIP ต้องมีขนาดไม่เกิน 50 MB");
  }
  return buffer;
}

export function isSafeFilePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return Boolean(normalized) &&
    normalized === path.replace(/\\/g, "/").replace(/^\/+/, "") &&
    !normalized.includes("..") &&
    !normalized.startsWith(".git/") &&
    !normalized.includes("/.git/") &&
    !normalized.startsWith("node_modules/") &&
    !normalized.includes("/node_modules/") &&
    normalized.length <= 500;
}

function isProbablyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  return sample.some(byte => byte === 0 || (byte < 7) || (byte > 14 && byte < 32));
}

function toProjectName(candidate: string): string {
  const cleaned = candidate
    .replace(/\.zip$/i, "")
    .replace(/[^a-zA-Z0-9ก-๙._ -]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "Untitled project";
}

export async function inspectZip(buffer: Buffer): Promise<ProjectSnapshot> {
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });
  const entries: ProjectFileIndexEntry[] = [];
  const textFiles: Record<string, string> = {};
  let totalBytes = 0;

  const files = Object.values(zip.files).filter(file => !file.dir);
  if (!files.length) throw new Error("ไม่พบไฟล์ภายใน ZIP");
  if (files.length > MAX_FILES) throw new Error(`รองรับได้สูงสุด ${MAX_FILES} ไฟล์ต่อโครงการ`);

  for (const file of files) {
    const path = file.name.replace(/^\/+/, "");
    if (!isSafeFilePath(path)) throw new Error(`พบเส้นทางไฟล์ที่ไม่อนุญาต: ${file.name}`);
    const bytes = await file.async("uint8array");
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_UNZIPPED_BYTES) {
      throw new Error("ขนาดไฟล์หลังแตกต้องไม่เกิน 200 MB");
    }
    const binary = isProbablyBinary(bytes);
    entries.push({ path, bytes: bytes.byteLength, binary });
    if (!binary && bytes.byteLength <= MAX_FILE_TEXT_BYTES) {
      textFiles[path] = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  }

  return { zip, entries, textFiles };
}

export function parseGitUrl(rawUrl: string): { platform: "github" | "gitlab"; owner: string; repo: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("โปรดระบุ URL repository แบบ HTTPS ที่ถูกต้อง");
  }
  if (parsed.protocol !== "https:") throw new Error("รองรับเฉพาะ URL แบบ HTTPS");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com" && host !== "gitlab.com") {
    throw new Error("เวอร์ชันแรกนี้รองรับ public repository จาก GitHub และ GitLab เท่านั้น");
  }
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    throw new Error("URL repository ต้องมีรูปแบบ github.com/owner/repository");
  }
  return { platform: host === "github.com" ? "github" : "gitlab", owner: segments[0], repo: segments[1].replace(/\.git$/i, "") };
}

async function downloadPublicRepository(rawUrl: string): Promise<{ buffer: Buffer; name: string; platform: "github" | "gitlab" }> {
  const info = parseGitUrl(rawUrl);
  let archiveUrl = "";
  if (info.platform === "github") {
    const metadata = await fetch(`https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "SILELO-Repo-Bot" },
    });
    if (!metadata.ok) throw new Error("ไม่สามารถเข้าถึง repository นี้ได้ โปรดตรวจว่าลิงก์เป็น public repository");
    const data = await metadata.json() as { private?: boolean; default_branch?: string; name?: string };
    if (data.private || !data.default_branch) throw new Error("รองรับเฉพาะ public repository ที่มี default branch");
    archiveUrl = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/zipball/${encodeURIComponent(data.default_branch)}`;
  } else {
    const projectPath = encodeURIComponent(`${info.owner}/${info.repo}`);
    const metadata = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}`);
    if (!metadata.ok) throw new Error("ไม่สามารถเข้าถึง repository นี้ได้ โปรดตรวจว่าลิงก์เป็น public repository");
    const data = await metadata.json() as { visibility?: string; default_branch?: string; path?: string };
    if (data.visibility !== "public" || !data.default_branch) throw new Error("รองรับเฉพาะ public repository ที่มี default branch");
    archiveUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/archive.zip?sha=${encodeURIComponent(data.default_branch)}`;
  }
  const archiveResponse = await fetch(archiveUrl, { redirect: "follow" });
  if (!archiveResponse.ok) throw new Error("ดาวน์โหลดไฟล์ repository ไม่สำเร็จ");
  const contentLength = Number(archiveResponse.headers.get("content-length") || "0");
  if (contentLength > REPO_MAX_ARCHIVE_BYTES) throw new Error("ไฟล์ repository มีขนาดเกิน 50 MB");
  const buffer = Buffer.from(await archiveResponse.arrayBuffer());
  if (!buffer.length || buffer.length > REPO_MAX_ARCHIVE_BYTES) throw new Error("ไฟล์ repository ต้องมีขนาดไม่เกิน 50 MB");
  return { buffer, name: toProjectName(`${info.owner}-${info.repo}`), platform: info.platform };
}

function stripMarkdownFence(value: string) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

function validateProposal(candidate: LlmProposal, snapshot: ProjectSnapshot): LlmProposal {
  const existingPaths = new Set(snapshot.entries.filter(entry => !entry.binary).map(entry => entry.path));
  let totalContent = 0;
  const changes = (candidate.changes || [])
    .slice(0, MAX_PROPOSAL_FILES)
    .filter(change => change && isSafeFilePath(change.path) && ["create", "update", "delete"].includes(change.action))
    .filter(change => change.action === "create" || existingPaths.has(change.path))
    .filter(change => change.action === "delete" || typeof change.content === "string")
    .filter(change => {
      totalContent += change.content?.length ?? 0;
      return totalContent <= MAX_PROPOSAL_TEXT_BYTES;
    })
    .map(change => ({
      path: change.path,
      action: change.action,
      explanation: String(change.explanation || "ปรับปรุงตามคำสั่ง"),
      content: change.action === "delete" ? undefined : String(change.content || ""),
    } as ProposalFile));

  return {
    summary: String(candidate.summary || "ข้อเสนอการแก้ไขโค้ด"),
    analysis: String(candidate.analysis || "ระบบได้วิเคราะห์คำสั่งแล้ว"),
    changes,
  };
}

export function makeDiff(snapshot: ProjectSnapshot, changes: ProposalFile[]) {
  return changes.map(change => {
    const before = snapshot.textFiles[change.path] ?? "";
    const after = change.action === "delete" ? "" : (change.content ?? "");
    return createTwoFilesPatch(change.path, change.path, before, after, "ต้นฉบับ", "ข้อเสนอ", { context: 3 });
  }).join("\n");
}

async function loadSnapshotForProject(projectId: number, userId: number) {
  const project = await getProjectForUser(projectId, userId);
  if (!project) throw new Error("ไม่พบโครงการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง");
  const signedUrl = await storageGetSignedUrl(project.sourceArchiveKey);
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("ไม่สามารถโหลดไฟล์ต้นฉบับของโครงการได้");
  const snapshot = await inspectZip(Buffer.from(await response.arrayBuffer()));
  return { project, snapshot };
}

async function createImportedProject(input: {
  userId: number;
  archive: Buffer;
  name: string;
  sourceType: "github" | "gitlab" | "zip";
  sourceUrl?: string;
  originalFilename: string;
}) {
  const snapshot = await inspectZip(input.archive);
  const storage = await storagePut(
    `repo-bot/${input.userId}/source/${Date.now()}-${input.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "-")}`,
    input.archive,
    "application/zip",
  );
  const project = await createProject({
    userId: input.userId,
    name: input.name,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    originalFilename: input.originalFilename,
    sourceArchiveKey: storage.key,
    fileIndex: snapshot.entries,
  });
  await createArtifact({
    projectId: project.id,
    userId: input.userId,
    kind: "source",
    filename: input.originalFilename,
    storageKey: storage.key,
    storageUrl: storage.url,
    bytes: input.archive.byteLength,
  });
  await createMessage({
    projectId: project.id,
    userId: input.userId,
    role: "assistant",
    content: `นำเข้า **${project.name}** สำเร็จแล้ว พบ ${snapshot.entries.length} ไฟล์ พร้อมรับคำสั่งแก้ไขโค้ด\n\n> ระบบทำงานกับสำเนา ZIP เท่านั้น ไม่มีการขอ token และจะไม่ commit หรือ push กลับไปยัง repository`,
  });
  return { project, entries: snapshot.entries };
}

export const repoBotRouter = router({
  listProjects: protectedProcedure.query(({ ctx }) => listProjectsForUser(ctx.user.id)),

  projectWorkspace: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const project = await getProjectForUser(input.projectId, ctx.user.id);
    if (!project) throw new Error("ไม่พบโครงการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง");
    const [messages, changes, artifacts] = await Promise.all([
      listMessagesForProject(project.id, ctx.user.id),
      listChangesForProject(project.id, ctx.user.id),
      listArtifactsForProject(project.id, ctx.user.id),
    ]);
    return { project, messages, changes, artifacts, files: JSON.parse(project.fileIndex) as ProjectFileIndexEntry[] };
  }),

  importFromUrl: protectedProcedure.input(z.object({ url: z.string().url().max(2048) })).mutation(async ({ ctx, input }) => {
    const download = await downloadPublicRepository(input.url);
    return createImportedProject({
      userId: ctx.user.id,
      archive: download.buffer,
      name: download.name,
      sourceType: download.platform,
      sourceUrl: input.url,
      originalFilename: `${download.name}.zip`,
    });
  }),

  importZip: protectedProcedure.input(z.object({
    filename: z.string().min(1).max(255).regex(/\.zip$/i, "รองรับเฉพาะไฟล์ .zip"),
    dataUrl: z.string().max(Math.ceil(REPO_MAX_ARCHIVE_BYTES * 1.4)),
  })).mutation(async ({ ctx, input }) => {
    const archive = decodeBase64(input.dataUrl);
    return createImportedProject({
      userId: ctx.user.id,
      archive,
      name: toProjectName(input.filename),
      sourceType: "zip",
      originalFilename: input.filename,
    });
  }),

  proposeChange: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    instruction: z.string().min(4).max(6000),
    intent: z.string().trim().min(2).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
    const { project, snapshot } = await loadSnapshotForProject(input.projectId, ctx.user.id);
    const intent = input.intent ?? "code_edit";
    const inputTokens = Math.ceil(input.instruction.length / 4);
    await createMessage({ projectId: project.id, userId: ctx.user.id, role: "user", content: input.instruction, intent, inputTokens });
    const codeContext = Object.entries(snapshot.textFiles)
      .slice(0, 80)
      .map(([path, content]) => `--- ${path} ---\n${content.slice(0, MAX_FILE_TEXT_BYTES)}`)
      .join("\n\n");
    const startedAt = Date.now();
    const response = await invokeLLM({
      max_tokens: 6000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "repo_edit_proposal",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              analysis: { type: "string" },
              changes: {
                type: "array",
                maxItems: MAX_PROPOSAL_FILES,
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    action: { type: "string", enum: ["create", "update", "delete"] },
                    explanation: { type: "string" },
                    content: { type: "string" },
                  },
                  required: ["path", "action", "explanation", "content"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "analysis", "changes"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: REPOSITORY_SAFETY_INSTRUCTION,
        },
        {
          role: "user",
          content: `ชื่อโครงการ: ${project.name}\nคำสั่งผู้ใช้: ${input.instruction}\n\nไฟล์ที่อ่านได้ในโครงการ:\n${codeContext}`,
        },
      ],
    });
    const latencyMs = Date.now() - startedAt;
    const raw = response.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("โมเดลภาษาไม่ส่งข้อเสนอการแก้ไขกลับมา");
    let proposed: LlmProposal;
    try {
      proposed = JSON.parse(stripMarkdownFence(raw)) as LlmProposal;
    } catch {
      throw new Error("โมเดลภาษาตอบกลับในรูปแบบที่ตรวจสอบไม่ได้ โปรดลองสั่งใหม่ให้เฉพาะเจาะจงขึ้น");
    }
    const proposal = validateProposal(proposed, snapshot);
    if (!proposal.changes.length) throw new Error("ไม่พบไฟล์ที่แก้ไขได้จากข้อเสนอ โปรดลองระบุชื่อไฟล์หรือเป้าหมายให้ชัดเจนขึ้น");
    const diffText = makeDiff(snapshot, proposal.changes);
    const responseModel = typeof response.model === "string" ? response.model : "SILELO Core";
    const outputTokens = Math.ceil((raw.length + diffText.length) / 4);
    const changeId = await createChangeRequest({
      projectId: project.id,
      userId: ctx.user.id,
      instruction: input.instruction,
      summary: `${proposal.summary}\n\n${proposal.analysis}`,
      proposal: proposal.changes,
      diffText,
    });
    const assistantMessage = `## ${proposal.summary}\n\n${proposal.analysis}\n\n**ไฟล์ที่เสนอให้เปลี่ยน:** ${proposal.changes.map(change => `\`${change.path}\``).join(", ")}\n\nตรวจสอบ diff ในแผงด้านขวาก่อนเลือก **ส่งออก ZIP** — ระบบจะไม่ commit หรือ push กลับไปยัง repository`;
    const assistantMessageId = await createMessage({ projectId: project.id, userId: ctx.user.id, role: "assistant", content: assistantMessage, model: responseModel, intent, inputTokens, outputTokens, costMicrousd: 0 });
    await createAiTrace({
      userId: ctx.user.id,
      projectId: project.id,
      messageId: assistantMessageId,
      model: responseModel,
      intent,
      outcome: "success",
      latencyMs,
      inputTokens,
      outputTokens,
      costMicrousd: 0,
      detail: { route: "SILELO Core", proposalFiles: proposal.changes.map(change => change.path) },
    });
    return { changeId, message: assistantMessage, summary: proposal.summary, files: proposal.changes, diffText };
  }),

  exportChange: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    changeId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const { project, snapshot } = await loadSnapshotForProject(input.projectId, ctx.user.id);
    const change = await getChangeForUser(input.changeId, ctx.user.id);
    if (!change || change.projectId !== project.id) throw new Error("ไม่พบข้อเสนอการแก้ไขนี้");
    if (change.status === "rejected") throw new Error("ข้อเสนอการแก้ไขนี้ถูกยกเลิกแล้ว");
    const proposal = JSON.parse(change.proposalJson) as ProposalFile[];
    for (const file of proposal) {
      if (!isSafeFilePath(file.path)) throw new Error("พบเส้นทางไฟล์ที่ไม่ปลอดภัยในข้อเสนอ");
      if (file.action === "delete") snapshot.zip.remove(file.path);
      else snapshot.zip.file(file.path, file.content ?? "");
    }
    const archive = await snapshot.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const filename = `${toProjectName(project.name).replace(/\s+/g, "-").toLowerCase()}-edited-${Date.now()}.zip`;
    const stored = await storagePut(`repo-bot/${ctx.user.id}/exports/${filename}`, archive, "application/zip");
    await createArtifact({
      projectId: project.id,
      userId: ctx.user.id,
      kind: "export",
      filename,
      storageKey: stored.key,
      storageUrl: stored.url,
      bytes: archive.byteLength,
    });
    await markChangeExported(change.id, ctx.user.id);
    const message = `สร้าง ZIP ฉบับแก้ไขแล้ว พร้อมดาวน์โหลด: [**${filename}**](${stored.url})\n\n> ไฟล์นี้สร้างจากสำเนาที่นำเข้าเท่านั้น ไม่มีการ commit หรือ push กลับไปยัง repository`;
    await createMessage({ projectId: project.id, userId: ctx.user.id, role: "assistant", content: message });
    return { filename, url: stored.url, message };
  }),
});
