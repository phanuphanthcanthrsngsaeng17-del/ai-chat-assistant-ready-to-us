import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash, timingSafeEqual } from "crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  aiChannels,
  aiTraces,
  channelProfiles,
  chatMessages,
  commandQueueItems,
  conversationSnapshots,
  conversationTagLinks,
  conversationTags,
  conversationThreads,
  intentPatterns,
  messageAnnotations,
  messageBookmarks,
  messageFeedback,
  promptTemplates,
  sharedConversationLinks,
  syncPreferences,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { invokeLLM, listLLMModels } from "../_core/llm";
import { generateImage } from "../_core/imageGeneration";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

const providerSchema = z.enum(["builtin", "openai", "groq", "openrouter", "puter", "custom"]);
const safeJson = (value: unknown) => JSON.stringify(value, null, 2);
const parseJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const importChannelSchema = z.object({ name: z.string().trim().min(2).max(100), provider: providerSchema, modelIds: z.array(z.string().trim().min(1).max(255)).min(1).max(30), selectedModel: z.string().trim().min(1).max(255).optional(), webFetchEnabled: z.boolean().optional(), isEnabled: z.boolean().optional() });
export function aggregateChannelHealth(traces: Array<{ channelId: number | null; latencyMs: number; outcome: string }>, channels: Array<{ id: number; name: string; connectionState: string }>) {
  return channels.map(channel => {
    const rows = traces.filter(trace => trace.channelId === channel.id);
    const success = rows.filter(trace => trace.outcome === "success").length;
    const errors = rows.filter(trace => trace.outcome === "error").length;
    return { id: channel.id, name: channel.name, connectionState: channel.connectionState, requests: rows.length, averageLatencyMs: rows.length ? Math.round(rows.reduce((sum, trace) => sum + trace.latencyMs, 0) / rows.length) : null, successRate: rows.length ? Math.round((success / rows.length) * 100) : null, errorRate: rows.length ? Math.round((errors / rows.length) * 100) : null };
  });
}

export function validateImportSettings(value: unknown) {
  const parsed = z.object({ channels: z.array(importChannelSchema).min(1).max(12), profiles: z.array(z.object({ name: z.string().trim().min(2).max(100), description: z.string().max(500).nullable().optional(), systemPrompt: z.string().max(4000).nullable().optional(), temperature: z.number().int().min(0).max(100).optional(), taskFocus: z.string().trim().min(2).max(80).optional(), channelId: z.number().int().positive().optional() })).optional() }).parse(value);
  return parsed;
}

export const skillCatalog = [
  ["สรุปเนื้อหา", "research", "สรุป {{content}} เป็นประเด็นสำคัญ พร้อมรายการสิ่งที่ต้องทำ"],
  ["แปลภาษา", "language", "แปล {{content}} เป็นภาษาไทย โดยรักษาความหมายและรูปแบบ"],
  ["ตรวจโค้ด", "development", "ตรวจโค้ดใน {{file}} หา bug, security issue และข้อเสนอที่นำไปใช้ได้"],
  ["อธิบายโค้ด", "development", "อธิบายหน้าที่และลำดับการทำงานของ {{file}} เป็นภาษาไทย"],
  ["วาง refactor", "development", "เสนอแผน refactor สำหรับ {{scope}} พร้อมผลกระทบและลำดับดำเนินการ"],
  ["เขียน unit test", "development", "เพิ่ม unit test สำหรับ {{scope}} ครอบคลุม success, failure และ edge cases"],
  ["ตรวจ accessibility", "quality", "ตรวจ accessibility ของ {{scope}} ตาม semantic HTML, keyboard และ contrast"],
  ["ตรวจ performance", "quality", "วิเคราะห์คอขวดด้าน performance ใน {{scope}} และเสนอการแก้ตามลำดับผลกระทบ"],
  ["ออกแบบ API", "development", "ออกแบบ API สำหรับ {{feature}} ระบุ endpoint, validation, error และตัวอย่าง request/response"],
  ["เขียนเอกสาร", "documentation", "เขียนเอกสารใช้งาน {{feature}} แบบกระชับ พร้อมตัวอย่าง"],
  ["สร้าง README", "documentation", "ร่าง README สำหรับ {{project}} ครอบคลุมการติดตั้ง การใช้งาน และการแก้ปัญหา"],
  ["เขียน release note", "documentation", "สรุป release note จากการเปลี่ยนแปลง {{changes}} เป็นภาษาไทย"],
  ["วิเคราะห์ error", "troubleshooting", "วิเคราะห์ error ต่อไปนี้: {{error}} ระบุสาเหตุที่เป็นไปได้และขั้นตอนแก้"],
  ["วางแผน debug", "troubleshooting", "สร้าง debug plan สำหรับ {{issue}} โดยเริ่มจากข้อมูลที่ตรวจสอบได้"],
  ["ออกแบบ migration", "database", "ออกแบบ database migration สำหรับ {{change}} พร้อมความเสี่ยงและแผน rollback"],
  ["ตรวจ query", "database", "วิเคราะห์ query นี้เพื่อหา index และ performance improvement: {{query}}"],
  ["สร้าง regex", "utility", "สร้าง regex สำหรับ {{requirement}} พร้อมตัวอย่างผ่านและไม่ผ่าน"],
  ["ออกแบบ type", "development", "ออกแบบ TypeScript types สำหรับ {{domain}} พร้อมข้อจำกัดที่สำคัญ"],
  ["ตรวจ security", "security", "ตรวจความเสี่ยง security ใน {{scope}} โดยเน้น input validation, auth และข้อมูลลับ"],
  ["จำลอง threat model", "security", "สร้าง threat model ย่อสำหรับ {{feature}} พร้อมมาตรการลดความเสี่ยง"],
  ["เขียน commit message", "workflow", "ร่าง commit message แบบ conventional สำหรับการเปลี่ยนแปลง {{changes}}"],
  ["สรุป diff", "workflow", "สรุป diff นี้เป็นภาษาไทย ระบุ behavior ที่เปลี่ยนและความเสี่ยง: {{diff}}"],
  ["วาง test plan", "quality", "สร้าง test plan สำหรับ {{feature}} ครอบคลุม unit, integration และ manual validation"],
  ["เขียน acceptance criteria", "product", "เขียน acceptance criteria สำหรับ {{feature}} ให้ทดสอบได้ชัดเจน"],
  ["จัดลำดับงาน", "product", "จัดลำดับงาน {{backlog}} ตาม impact, effort และความเสี่ยง"],
  ["วิเคราะห์ requirement", "product", "แยก requirement ของ {{feature}} เป็น user flow, edge case และคำถามค้าง"],
  ["ออกแบบ UX copy", "content", "เขียน microcopy สำหรับ {{screen}} ให้ชัดเจน กระชับ และช่วยผู้ใช้ตัดสินใจ"],
  ["ปรับภาษาไทย", "content", "ปรับข้อความ {{content}} ให้เป็นภาษาไทยแบบมืออาชีพและเข้าใจง่าย"],
  ["เขียน email", "content", "ร่างอีเมลเรื่อง {{topic}} โทน {{tone}} พร้อมหัวข้ออีเมล"],
  ["สร้าง checklist", "workflow", "สร้าง checklist สำหรับ {{process}} แบบทำตามได้ทีละขั้น"],
  ["เปรียบเทียบทางเลือก", "analysis", "เปรียบเทียบ {{options}} โดยระบุข้อดี ข้อเสีย ความเสี่ยง และคำแนะนำแบบมีเงื่อนไข"],
  ["วิเคราะห์ root cause", "analysis", "วิเคราะห์ root cause ของ {{issue}} โดยแยกข้อเท็จจริง สมมติฐาน และข้อมูลที่ต้องตรวจเพิ่ม"],
  ["สกัดข้อมูล", "analysis", "สกัดข้อมูลสำคัญจาก {{content}} เป็นโครงสร้างที่นำไปใช้งานต่อได้"],
  ["ร่าง SQL", "database", "ร่าง SQL สำหรับ {{goal}} โดยคำนึงถึง validation และผลกระทบข้อมูล"],
  ["สร้าง diagram", "documentation", "อธิบาย Mermaid diagram สำหรับ {{system}} ที่แสดงองค์ประกอบและ data flow"],
  ["review architecture", "architecture", "review architecture ของ {{system}} ระบุ trade-off, scaling และจุดเสี่ยง"],
  ["ออกแบบ component", "frontend", "ออกแบบ React component สำหรับ {{feature}} โดยแยก state, props และ accessibility"],
  ["แก้ responsive", "frontend", "วิเคราะห์และเสนอการแก้ responsive สำหรับ {{screen}} ใน mobile, tablet และ desktop"],
  ["ตรวจ state management", "frontend", "ตรวจ state management ของ {{scope}} หา race condition และความซ้ำซ้อน"],
  ["ออกแบบ loading state", "frontend", "ออกแบบ loading, empty และ error states สำหรับ {{feature}} พร้อมข้อความที่ช่วยผู้ใช้"],
  ["ออกแบบ observability", "operations", "กำหนด logs, metrics และ traces สำหรับ {{system}} โดยปกปิดข้อมูลลับ"],
  ["สร้าง runbook", "operations", "เขียน runbook สำหรับเหตุการณ์ {{incident}} พร้อมลำดับตรวจสอบและเงื่อนไข escalate"],
  ["วิเคราะห์ค่าใช้จ่าย", "operations", "วิเคราะห์ปัจจัยค่าใช้จ่ายของ {{system}} และข้อเสนอควบคุมงบประมาณ"],
  ["สร้าง prompt", "ai", "สร้าง prompt แบบมีโครงสร้างสำหรับ {{goal}} พร้อมข้อจำกัดและรูปแบบคำตอบ"],
  ["ประเมินคำตอบ AI", "ai", "ประเมินคำตอบ AI นี้ด้วยเกณฑ์ความถูกต้อง ความครบถ้วน และความชัดเจน: {{answer}}"],
  ["จัดประเภท intent", "ai", "จัดประเภท intent ของข้อความ {{message}} พร้อม confidence และคำถามชี้แจงเมื่อจำเป็น"],
  ["สร้าง fixture", "development", "สร้าง test fixture ที่ไม่มีข้อมูลส่วนบุคคลสำหรับ {{scenario}}"],
  ["ตรวจ dependency", "quality", "ตรวจ dependency ของ {{package}} ว่ามีความเสี่ยง compatibility หรือ maintenance หรือไม่"],
  ["เขียน changelog", "documentation", "แปลง {{changes}} เป็น changelog ที่แยก Added, Changed, Fixed และ Breaking"],
  ["เตรียม PR review", "workflow", "สรุปสิ่งที่ reviewer ควรโฟกัสจาก {{changes}} พร้อมความเสี่ยงและ test evidence"],
] as const;

async function database() {
  const db = await getDb();
  if (!db) throw new Error("ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้");
  return db;
}

async function ensureDefaults(userId: number) {
  const db = await database();
  const channels = await db.select().from(aiChannels).where(eq(aiChannels.userId, userId));
  if (!channels.length) {
    const result = await db.insert(aiChannels).values({
      userId,
      name: "SILELO Core",
      provider: "builtin",
      modelIds: safeJson(["Auto-select"]),
      selectedModel: "Auto-select",
      connectionState: "online",
      isEnabled: 1,
    });
    const channelId = Number(result[0].insertId);
    await db.insert(channelProfiles).values({
      userId,
      channelId,
      name: "Code Architect",
      description: "วิเคราะห์โค้ดและเสนอการแก้ไขที่ตรวจสอบได้",
      systemPrompt: "อธิบายเหตุผลของการเปลี่ยนแปลงก่อนให้ผู้ใช้ส่งออกไฟล์เสมอ",
      temperature: 20,
      taskFocus: "development",
    });
  }
  const prefs = await db.select().from(syncPreferences).where(eq(syncPreferences.userId, userId));
  if (!prefs.length) await db.insert(syncPreferences).values({ userId, provider: "managed", isEnabled: 1 });
}

export function getIntent(message: string, patterns: Array<{ label: string; pattern: string; matchType: "keyword" | "regex" }>) {
  for (const pattern of patterns) {
    try {
      const match = pattern.matchType === "regex"
        ? new RegExp(pattern.pattern, "i").test(message)
        : message.toLowerCase().includes(pattern.pattern.toLowerCase());
      if (match) return { label: pattern.label, confidence: 92, alternatives: [] as string[] };
    } catch { /* Ignore malformed custom regex and preserve the conversation. */ }
  }
  const lower = message.toLowerCase();
  if (/(bug|error|แก้|ปัญหา|debug)/.test(lower)) return { label: "troubleshooting", confidence: 84, alternatives: ["code_review", "refactor"] };
  if (/(test|ทดสอบ|vitest|unit)/.test(lower)) return { label: "testing", confidence: 88, alternatives: ["code_review"] };
  if (/(doc|readme|เอกสาร|อธิบาย)/.test(lower)) return { label: "documentation", confidence: 78, alternatives: ["analysis"] };
  return { label: "code_edit", confidence: 66, alternatives: ["code_review", "refactor"] };
}

export function hashSharePassword(token: string, password: string) {
  return createHash("sha256").update(`${token}:${password}`).digest("hex");
}

function matchesSharePassword(expected: string, candidate: string) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const candidateBuffer = Buffer.from(candidate, "hex");
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

export const advancedRouter = router({
  workspace: protectedProcedure.query(async ({ ctx }) => {
    await ensureDefaults(ctx.user.id);
    const db = await database();
    const [channels, profiles, sync] = await Promise.all([
      db.select().from(aiChannels).where(eq(aiChannels.userId, ctx.user.id)).orderBy(desc(aiChannels.updatedAt)),
      db.select().from(channelProfiles).where(eq(channelProfiles.userId, ctx.user.id)).orderBy(desc(channelProfiles.updatedAt)),
      db.select().from(syncPreferences).where(eq(syncPreferences.userId, ctx.user.id)).limit(1),
    ]);
    return { channels, profiles, sync: sync[0] ?? null, skillCatalog };
  }),

  saveChannel: protectedProcedure.input(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(2).max(100),
    provider: providerSchema,
    modelIds: z.array(z.string().trim().min(1).max(255)).min(1).max(30),
    selectedModel: z.string().trim().min(1).max(255),
    webFetchEnabled: z.boolean().default(false),
    isEnabled: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const values = { name: input.name, provider: input.provider, modelIds: safeJson(input.modelIds), selectedModel: input.selectedModel, webFetchEnabled: input.webFetchEnabled ? 1 : 0, isEnabled: input.isEnabled ? 1 : 0 };
    if (input.id) {
      await db.update(aiChannels).set(values).where(and(eq(aiChannels.id, input.id), eq(aiChannels.userId, ctx.user.id)));
      return { id: input.id };
    }
    const created = await db.insert(aiChannels).values({ userId: ctx.user.id, ...values, connectionState: "not_configured" });
    return { id: Number(created[0].insertId) };
  }),

  setChannelEnabled: protectedProcedure.input(z.object({ id: z.number().int().positive(), isEnabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const updated = await db.update(aiChannels).set({ isEnabled: input.isEnabled ? 1 : 0 }).where(and(eq(aiChannels.id, input.id), eq(aiChannels.userId, ctx.user.id)));
    if (!updated[0].affectedRows) throw new Error("ไม่พบช่องทางที่เลือก");
    return { success: true, isEnabled: input.isEnabled };
  }),

  testChannel: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const channel = (await db.select().from(aiChannels).where(and(eq(aiChannels.id, input.id), eq(aiChannels.userId, ctx.user.id))).limit(1))[0];
    if (!channel) throw new Error("ไม่พบช่องทางที่เลือก");
    if (channel.provider !== "builtin") {
      return { state: "not_configured" as const, latencyMs: null, detail: "ช่องทางนี้ยังไม่มีการเชื่อมต่อที่ผู้ใช้อนุญาต จึงไม่มีการส่งข้อมูลหรือทดสอบเครือข่าย" };
    }
    const started = Date.now();
    try {
      const result = await listLLMModels();
      const latencyMs = Date.now() - started;
      const models = result.data.slice(0, 30).map(model => model.id);
      await db.update(aiChannels).set({ connectionState: "online", lastLatencyMs: latencyMs, modelIds: safeJson(models), selectedModel: channel.selectedModel === "Auto-select" ? (models[0] ?? "Auto-select") : channel.selectedModel }).where(eq(aiChannels.id, channel.id));
      return { state: "online" as const, latencyMs, detail: `พบ ${models.length} รุ่นที่ใช้งานได้จากช่องทางในตัว` };
    } catch {
      const latencyMs = Date.now() - started;
      await db.update(aiChannels).set({ connectionState: "offline", lastLatencyMs: latencyMs }).where(eq(aiChannels.id, channel.id));
      return { state: "offline" as const, latencyMs, detail: "ไม่สามารถตรวจสอบช่องทางในขณะนี้ โปรดลองใหม่ภายหลัง" };
    }
  }),

  saveProfile: protectedProcedure.input(z.object({
    id: z.number().int().positive().optional(),
    channelId: z.number().int().positive(),
    name: z.string().trim().min(2).max(100),
    description: z.string().max(500).optional(),
    systemPrompt: z.string().max(4000).optional(),
    temperature: z.number().int().min(0).max(100),
    taskFocus: z.string().trim().min(2).max(80),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const channel = (await db.select({ id: aiChannels.id }).from(aiChannels).where(and(eq(aiChannels.id, input.channelId), eq(aiChannels.userId, ctx.user.id))).limit(1))[0];
    if (!channel) throw new Error("ไม่พบช่องทางที่เลือก");
    const values = { channelId: input.channelId, name: input.name, description: input.description ?? null, systemPrompt: input.systemPrompt ?? null, temperature: input.temperature, taskFocus: input.taskFocus };
    if (input.id) {
      await db.update(channelProfiles).set(values).where(and(eq(channelProfiles.id, input.id), eq(channelProfiles.userId, ctx.user.id)));
      return { id: input.id };
    }
    const created = await db.insert(channelProfiles).values({ userId: ctx.user.id, ...values });
    return { id: Number(created[0].insertId) };
  }),

  exportSettings: protectedProcedure.query(async ({ ctx }) => {
    await ensureDefaults(ctx.user.id);
    const db = await database();
    const [channels, profiles, sync] = await Promise.all([
      db.select().from(aiChannels).where(eq(aiChannels.userId, ctx.user.id)),
      db.select().from(channelProfiles).where(eq(channelProfiles.userId, ctx.user.id)),
      db.select().from(syncPreferences).where(eq(syncPreferences.userId, ctx.user.id)).limit(1),
    ]);
    const settings = {
      version: 1,
      exportedAt: new Date().toISOString(),
      channels: channels.map(channel => ({ name: channel.name, provider: channel.provider, modelIds: parseJson<string[]>(channel.modelIds, []), selectedModel: channel.selectedModel, webFetchEnabled: Boolean(channel.webFetchEnabled) })),
      profiles: profiles.map(profile => ({ channelId: profile.channelId, name: profile.name, description: profile.description, systemPrompt: profile.systemPrompt, temperature: profile.temperature, taskFocus: profile.taskFocus })),
      sync: sync[0] ? { provider: sync[0].provider, isEnabled: Boolean(sync[0].isEnabled) } : { provider: "managed", isEnabled: true },
    };
    const envExample = ["# SILELO Repo Bot export", "# Secrets are intentionally omitted. Configure any provider credential in your deployment's secret manager.", "SILELO_CHANNELS_JSON=channels.json", "SILELO_SYNC_PROVIDER=managed"].join("\n");
    return { filename: `silelo-settings-${Date.now()}.json`, json: safeJson(settings), envExample };
  }),

  importSettings: protectedProcedure.input(z.object({ json: z.string().min(2).max(150000) })).mutation(async ({ ctx, input }) => {
    const parsed = validateImportSettings(parseJson<unknown>(input.json, {}));
    const db = await database();
    const channelIds: number[] = [];
    for (const entry of parsed.channels.slice(0, 12)) {
      const channel = importChannelSchema.parse(entry);
      const created = await db.insert(aiChannels).values({ userId: ctx.user.id, name: channel.name, provider: channel.provider, modelIds: safeJson(channel.modelIds), selectedModel: channel.selectedModel ?? channel.modelIds[0], connectionState: channel.provider === "builtin" ? "online" : "not_configured", webFetchEnabled: channel.webFetchEnabled ? 1 : 0, isEnabled: channel.isEnabled === false ? 0 : 1 });
      channelIds.push(Number(created[0].insertId));
    }
    return { imported: channelIds.length, message: "นำเข้าการตั้งค่าโดยไม่มี credential หรือค่าลับ" };
  }),

  templates: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const custom = await db.select().from(promptTemplates).where(eq(promptTemplates.userId, ctx.user.id)).orderBy(desc(promptTemplates.updatedAt));
    return { builtIn: skillCatalog.map(([name, category, template], index) => ({ id: `skill-${index + 1}`, name, category, template, variables: "{{content}}, {{scope}}", isBuiltIn: 1 })), custom };
  }),

  saveTemplate: protectedProcedure.input(z.object({ id: z.number().int().positive().optional(), name: z.string().trim().min(2).max(120), category: z.string().trim().min(2).max(80), template: z.string().trim().min(4).max(8000), variables: z.string().max(1024).optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const values = { name: input.name, category: input.category, template: input.template, variables: input.variables ?? null };
    if (input.id) {
      await db.update(promptTemplates).set(values).where(and(eq(promptTemplates.id, input.id), eq(promptTemplates.userId, ctx.user.id)));
      return { id: input.id };
    }
    const created = await db.insert(promptTemplates).values({ userId: ctx.user.id, ...values, isBuiltIn: 0 });
    return { id: Number(created[0].insertId) };
  }),

  deleteTemplate: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    await db.delete(promptTemplates).where(and(eq(promptTemplates.id, input.id), eq(promptTemplates.userId, ctx.user.id)));
    return { success: true };
  }),

  conversationTools: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await database();
    const [threads, tags, snapshots, queue, patterns, shares, channels, bookmarkRows] = await Promise.all([
      db.select().from(conversationThreads).where(and(eq(conversationThreads.userId, ctx.user.id), eq(conversationThreads.projectId, input.projectId))).orderBy(desc(conversationThreads.updatedAt)),
      db.select().from(conversationTags).where(eq(conversationTags.userId, ctx.user.id)),
      db.select().from(conversationSnapshots).where(and(eq(conversationSnapshots.userId, ctx.user.id), eq(conversationSnapshots.projectId, input.projectId))).orderBy(desc(conversationSnapshots.createdAt)),
      db.select().from(commandQueueItems).where(and(eq(commandQueueItems.userId, ctx.user.id), eq(commandQueueItems.projectId, input.projectId))).orderBy(commandQueueItems.position),
      db.select().from(intentPatterns).where(eq(intentPatterns.userId, ctx.user.id)),
      db.select().from(sharedConversationLinks).where(and(eq(sharedConversationLinks.userId, ctx.user.id), eq(sharedConversationLinks.projectId, input.projectId), eq(sharedConversationLinks.isActive, 1))).orderBy(desc(sharedConversationLinks.createdAt)),
      db.select().from(aiChannels).where(eq(aiChannels.userId, ctx.user.id)),
      db.select().from(messageBookmarks).where(eq(messageBookmarks.userId, ctx.user.id)).orderBy(desc(messageBookmarks.createdAt)),
    ]);
    const bookmarkIds = bookmarkRows.map(bookmark => bookmark.messageId);
    const bookmarkedMessages = bookmarkIds.length
      ? await db.select().from(chatMessages).where(and(eq(chatMessages.userId, ctx.user.id), inArray(chatMessages.id, bookmarkIds))).orderBy(desc(chatMessages.createdAt))
      : [];
    const queueSummary = {
      pending: queue.filter(item => item.status === "pending").length,
      running: queue.filter(item => item.status === "running").length,
      complete: queue.filter(item => item.status === "complete").length,
    };
    const channelSummary = {
      online: channels.filter(channel => channel.connectionState === "online").length,
      offline: channels.filter(channel => channel.connectionState === "offline").length,
      notConfigured: channels.filter(channel => channel.connectionState === "not_configured").length,
    };
    return { threads, tags, snapshots, queue, patterns, shares, bookmarks: bookmarkedMessages, queueSummary, channelSummary };
  }),

  createThread: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), title: z.string().trim().min(2).max(255), parentThreadId: z.number().int().positive().optional(), branchFromMessageId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const created = await db.insert(conversationThreads).values({ userId: ctx.user.id, projectId: input.projectId, title: input.title, parentThreadId: input.parentThreadId ?? null, branchFromMessageId: input.branchFromMessageId ?? null, status: "active" });
    return { id: Number(created[0].insertId) };
  }),

  createSnapshot: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), threadId: z.number().int().positive().optional(), name: z.string().trim().min(2).max(160), stateJson: z.string().min(2).max(500000) })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const created = await db.insert(conversationSnapshots).values({ userId: ctx.user.id, projectId: input.projectId, threadId: input.threadId ?? null, name: input.name, stateJson: input.stateJson });
    return { id: Number(created[0].insertId) };
  }),

  createTag: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(64), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const created = await db.insert(conversationTags).values({ userId: ctx.user.id, ...input });
    return { id: Number(created[0].insertId) };
  }),

  createIntentPattern: protectedProcedure.input(z.object({ label: z.string().trim().min(2).max(100), pattern: z.string().trim().min(1).max(500), matchType: z.enum(["keyword", "regex"]) })).mutation(async ({ ctx, input }) => {
    if (input.matchType === "regex") {
      try { new RegExp(input.pattern, "i"); } catch { throw new Error("รูปแบบ regex ไม่ถูกต้อง"); }
    }
    const db = await database();
    const created = await db.insert(intentPatterns).values({ userId: ctx.user.id, ...input, isActive: 1 });
    return { id: Number(created[0].insertId) };
  }),

  classifyIntent: protectedProcedure.input(z.object({ message: z.string().min(1).max(6000) })).query(async ({ ctx, input }) => {
    const db = await database();
    const patterns = await db.select().from(intentPatterns).where(and(eq(intentPatterns.userId, ctx.user.id), eq(intentPatterns.isActive, 1)));
    return getIntent(input.message, patterns);
  }),

  queueCommand: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), prompt: z.string().trim().min(4).max(6000), conditionJson: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const rows = await db.select({ position: commandQueueItems.position }).from(commandQueueItems).where(and(eq(commandQueueItems.userId, ctx.user.id), eq(commandQueueItems.projectId, input.projectId))).orderBy(desc(commandQueueItems.position)).limit(1);
    const created = await db.insert(commandQueueItems).values({ userId: ctx.user.id, projectId: input.projectId, prompt: input.prompt, conditionJson: input.conditionJson ?? null, position: (rows[0]?.position ?? 0) + 1, status: "pending" });
    return { id: Number(created[0].insertId) };
  }),

  summarizeConversation: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), threadId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const where = input.threadId
      ? and(eq(chatMessages.projectId, input.projectId), eq(chatMessages.userId, ctx.user.id), eq(chatMessages.threadId, input.threadId))
      : and(eq(chatMessages.projectId, input.projectId), eq(chatMessages.userId, ctx.user.id));
    const messages = await db.select().from(chatMessages).where(where).orderBy(chatMessages.createdAt).limit(80);
    if (!messages.length) throw new Error("ยังไม่มีข้อความสำหรับสรุป");
    const source = messages.map(message => `${message.role === "user" ? "ผู้ใช้" : "SILELO"}: ${message.content}`).join("\n\n").slice(0, 30000);
    const startedAt = Date.now();
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "สรุปบทสนทนาภาษาไทยเป็นหัวข้อ: เป้าหมาย, สิ่งที่ตัดสินใจ, ไฟล์/งานที่เกี่ยวข้อง, งานค้าง, และความเสี่ยง ห้ามแต่งข้อเท็จจริง" },
        { role: "user", content: source },
      ],
    });
    const generatedContent = response.choices?.[0]?.message?.content;
    const summary = typeof generatedContent === "string" ? generatedContent.trim() : "";
    if (!summary) throw new Error("ไม่สามารถสร้างสรุปได้ในขณะนี้");
    const model = typeof response.model === "string" ? response.model : "SILELO Core";
    const inputTokens = Math.ceil(source.length / 4);
    const outputTokens = Math.ceil(summary.length / 4);
    const inserted = await db.insert(chatMessages).values({ projectId: input.projectId, userId: ctx.user.id, threadId: input.threadId ?? null, role: "assistant", content: summary, model, intent: "conversation_summary", inputTokens, outputTokens, costMicrousd: 0 });
    const messageId = Number(inserted[0].insertId);
    await db.insert(messageBookmarks).values({ messageId, userId: ctx.user.id });
    await db.insert(aiTraces).values({ userId: ctx.user.id, projectId: input.projectId, messageId, model, intent: "conversation_summary", outcome: "success", latencyMs: Date.now() - startedAt, inputTokens, outputTokens, costMicrousd: 0, detailJson: safeJson({ route: "SILELO Core", automaticallyBookmarked: true }) });
    return { messageId, summary };
  }),

  createShare: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), threadId: z.number().int().positive().optional(), expiresInDays: z.number().int().min(1).max(30).default(7), password: z.string().min(8).max(128).optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86400000);
    const passwordHash = input.password ? hashSharePassword(token, input.password) : null;
    await db.insert(sharedConversationLinks).values({ userId: ctx.user.id, projectId: input.projectId, threadId: input.threadId ?? null, token, passwordHash, isActive: 1, expiresAt });
    return { token, expiresAt, requiresPassword: Boolean(passwordHash) };
  }),

  revokeShare: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    await db.update(sharedConversationLinks).set({ isActive: 0 }).where(and(eq(sharedConversationLinks.id, input.id), eq(sharedConversationLinks.userId, ctx.user.id)));
    return { success: true };
  }),

  addFeedback: protectedProcedure.input(z.object({ messageId: z.number().int().positive(), rating: z.enum(["up", "down"]), reason: z.string().max(128).optional(), comment: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const message = (await db.select().from(chatMessages).where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.userId, ctx.user.id))).limit(1))[0];
    if (!message) throw new Error("ไม่พบข้อความที่ให้คะแนน");
    await db.insert(messageFeedback).values({ userId: ctx.user.id, ...input });
    return { success: true };
  }),

  toggleBookmark: protectedProcedure.input(z.object({ messageId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const existing = (await db.select().from(messageBookmarks).where(and(eq(messageBookmarks.userId, ctx.user.id), eq(messageBookmarks.messageId, input.messageId))).limit(1))[0];
    if (existing) {
      await db.delete(messageBookmarks).where(eq(messageBookmarks.id, existing.id));
      return { bookmarked: false };
    }
    await db.insert(messageBookmarks).values({ userId: ctx.user.id, messageId: input.messageId });
    return { bookmarked: true };
  }),

  addAnnotation: protectedProcedure.input(z.object({ messageId: z.number().int().positive(), selectedText: z.string().min(1).max(1000), note: z.string().min(1).max(2000) })).mutation(async ({ ctx, input }) => {
    const db = await database();
    await db.insert(messageAnnotations).values({ userId: ctx.user.id, ...input });
    return { success: true };
  }),

  analytics: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const [messages, traces, feedback, channels] = await Promise.all([
      db.select().from(chatMessages).where(eq(chatMessages.userId, ctx.user.id)),
      db.select().from(aiTraces).where(eq(aiTraces.userId, ctx.user.id)),
      db.select().from(messageFeedback).where(eq(messageFeedback.userId, ctx.user.id)),
      db.select({ id: aiChannels.id, name: aiChannels.name, connectionState: aiChannels.connectionState }).from(aiChannels).where(eq(aiChannels.userId, ctx.user.id)),
    ]);
    const byModel = Object.entries(traces.reduce<Record<string, number>>((all, trace) => { all[trace.model] = (all[trace.model] ?? 0) + 1; return all; }, {})).map(([model, requests]) => ({ model, requests }));
    const byIntent = Object.entries(traces.reduce<Record<string, number>>((all, trace) => { all[trace.intent] = (all[trace.intent] ?? 0) + 1; return all; }, {})).map(([intent, requests]) => ({ intent, requests }));
    const totalCostMicrousd = traces.reduce((total, trace) => total + (trace.costMicrousd ?? 0), 0);
    const averageLatencyMs = traces.length ? Math.round(traces.reduce((total, trace) => total + trace.latencyMs, 0) / traces.length) : null;
    const outcomes = traces.reduce<Record<string, number>>((all, trace) => { all[trace.outcome] = (all[trace.outcome] ?? 0) + 1; return all; }, {});
    const channelHealth = aggregateChannelHealth(traces, channels);
    return { totals: { messages: messages.length, requests: traces.length, averageLatencyMs, totalCostMicrousd, positiveFeedback: feedback.filter(item => item.rating === "up").length, negativeFeedback: feedback.filter(item => item.rating === "down").length }, byModel, byIntent, outcomes, channelHealth };
  }),

  traceList: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await database();
    return db.select().from(aiTraces).where(and(eq(aiTraces.userId, ctx.user.id), eq(aiTraces.projectId, input.projectId))).orderBy(desc(aiTraces.createdAt)).limit(100);
  }),

  generateImages: protectedProcedure.input(z.object({ prompt: z.string().trim().min(4).max(2000), count: z.number().int().min(1).max(10) })).mutation(async ({ input }) => {
    const results: Array<{ index: number; url: string }> = [];
    for (let index = 0; index < input.count; index += 1) {
      const generated = await generateImage({ prompt: input.prompt });
      if (!generated.url) throw new Error(`สร้างภาพลำดับที่ ${index + 1} ไม่สำเร็จ`);
      results.push({ index: index + 1, url: generated.url });
    }
    return { prompt: input.prompt, results };
  }),

  sharedConversation: publicProcedure.input(z.object({ token: z.string().min(16).max(48), password: z.string().max(128).optional() })).query(async ({ input }) => {
    const db = await database();
    const share = (await db.select().from(sharedConversationLinks).where(and(eq(sharedConversationLinks.token, input.token), eq(sharedConversationLinks.isActive, 1))).limit(1))[0];
    if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now())) throw new Error("ลิงก์นี้หมดอายุหรือถูกเพิกถอนแล้ว");
    if (share.passwordHash) {
      if (!input.password) return { requiresPassword: true as const, expiresAt: share.expiresAt, messages: [] };
      if (!matchesSharePassword(share.passwordHash, hashSharePassword(share.token, input.password))) throw new Error("ไม่สามารถเข้าถึงลิงก์นี้ได้");
    }
    const where = share.threadId ? and(eq(chatMessages.projectId, share.projectId), eq(chatMessages.threadId, share.threadId)) : eq(chatMessages.projectId, share.projectId);
    const messages = await db.select({ role: chatMessages.role, content: chatMessages.content, model: chatMessages.model, createdAt: chatMessages.createdAt }).from(chatMessages).where(where).orderBy(chatMessages.createdAt).limit(200);
    return { requiresPassword: false as const, messages, expiresAt: share.expiresAt };
  }),
});
