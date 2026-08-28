import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  aiTraces,
  ChangeRequest,
  chatMessages,
  changeRequests,
  InsertUser,
  Project,
  projectArtifacts,
  projects,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export type ProjectFileIndexEntry = {
  path: string;
  bytes: number;
  binary: boolean;
};

export type CreateProjectInput = {
  userId: number;
  name: string;
  sourceType: "github" | "gitlab" | "zip";
  sourceUrl?: string;
  originalFilename?: string;
  sourceArchiveKey: string;
  rootFolder?: string;
  fileIndex: ProjectFileIndexEntry[];
};

export type ProposalFile = {
  path: string;
  action: "create" | "update" | "delete";
  explanation: string;
  content?: string;
};

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function requireDb(database: Awaited<ReturnType<typeof getDb>>) {
  if (!database) throw new Error("ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้");
  return database;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const database = await getDb();
  if (!database) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach(field => {
    if (user[field] !== undefined) {
      const value = user[field] ?? null;
      values[field] = value;
      updateSet[field] = value;
    }
  });
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;

  await database.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const database = requireDb(await getDb());
  const inserted = await database.insert(projects).values({
    userId: input.userId,
    name: input.name,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    originalFilename: input.originalFilename ?? null,
    sourceArchiveKey: input.sourceArchiveKey,
    rootFolder: input.rootFolder ?? null,
    fileIndex: JSON.stringify(input.fileIndex),
    status: "ready",
  });
  const project = await getProjectForUser(Number(inserted[0].insertId), input.userId);
  if (!project) throw new Error("สร้างโครงการไม่สำเร็จ");
  return project;
}

export async function listProjectsForUser(userId: number) {
  const database = requireDb(await getDb());
  return database.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectForUser(projectId: number, userId: number) {
  const database = requireDb(await getDb());
  const result = await database.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  return result[0];
}

export async function createArtifact(input: {
  projectId: number;
  userId: number;
  kind: "source" | "export";
  filename: string;
  storageKey: string;
  storageUrl: string;
  bytes: number;
}) {
  const database = requireDb(await getDb());
  await database.insert(projectArtifacts).values(input);
}

export async function listArtifactsForProject(projectId: number, userId: number) {
  const database = requireDb(await getDb());
  return database.select().from(projectArtifacts)
    .where(and(eq(projectArtifacts.projectId, projectId), eq(projectArtifacts.userId, userId)))
    .orderBy(desc(projectArtifacts.createdAt));
}

export async function createMessage(input: {
  projectId: number;
  userId: number;
  role: "user" | "assistant";
  content: string;
  threadId?: number | null;
  channelId?: number | null;
  model?: string | null;
  intent?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costMicrousd?: number | null;
}) {
  const database = requireDb(await getDb());
  const created = await database.insert(chatMessages).values({
    ...input,
    threadId: input.threadId ?? null,
    channelId: input.channelId ?? null,
    model: input.model ?? null,
    intent: input.intent ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    costMicrousd: input.costMicrousd ?? null,
  });
  return Number(created[0].insertId);
}

export async function createAiTrace(input: {
  userId: number;
  projectId: number;
  messageId?: number | null;
  channelId?: number | null;
  model: string;
  intent: string;
  outcome: "success" | "error" | "cached";
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costMicrousd?: number | null;
  detail?: Record<string, unknown>;
}) {
  const database = requireDb(await getDb());
  const created = await database.insert(aiTraces).values({
    userId: input.userId,
    projectId: input.projectId,
    messageId: input.messageId ?? null,
    channelId: input.channelId ?? null,
    model: input.model,
    intent: input.intent,
    outcome: input.outcome,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    costMicrousd: input.costMicrousd ?? null,
    detailJson: input.detail ? JSON.stringify(input.detail) : null,
  });
  return Number(created[0].insertId);
}

export async function listMessagesForProject(projectId: number, userId: number) {
  const database = requireDb(await getDb());
  return database.select().from(chatMessages)
    .where(and(eq(chatMessages.projectId, projectId), eq(chatMessages.userId, userId)))
    .orderBy(chatMessages.createdAt);
}

export async function createChangeRequest(input: {
  projectId: number;
  userId: number;
  instruction: string;
  summary: string;
  proposal: ProposalFile[];
  diffText: string;
}) {
  const database = requireDb(await getDb());
  const inserted = await database.insert(changeRequests).values({
    projectId: input.projectId,
    userId: input.userId,
    instruction: input.instruction,
    summary: input.summary,
    proposalJson: JSON.stringify(input.proposal),
    diffText: input.diffText,
    status: "proposed",
  });
  return Number(inserted[0].insertId);
}

export async function listChangesForProject(projectId: number, userId: number) {
  const database = requireDb(await getDb());
  return database.select().from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.userId, userId)))
    .orderBy(desc(changeRequests.createdAt));
}

export async function getChangeForUser(changeId: number, userId: number): Promise<ChangeRequest | undefined> {
  const database = requireDb(await getDb());
  const result = await database.select().from(changeRequests)
    .where(and(eq(changeRequests.id, changeId), eq(changeRequests.userId, userId)))
    .limit(1);
  return result[0];
}

export async function markChangeExported(changeId: number, userId: number) {
  const database = requireDb(await getDb());
  await database.update(changeRequests)
    .set({ status: "exported" })
    .where(and(eq(changeRequests.id, changeId), eq(changeRequests.userId, userId)));
}
