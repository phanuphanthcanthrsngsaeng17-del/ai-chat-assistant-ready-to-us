import {
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  sourceType: mysqlEnum("sourceType", ["github", "gitlab", "zip"]).notNull(),
  sourceUrl: text("sourceUrl"),
  originalFilename: varchar("originalFilename", { length: 512 }),
  sourceArchiveKey: varchar("sourceArchiveKey", { length: 1024 }).notNull(),
  rootFolder: varchar("rootFolder", { length: 512 }),
  fileIndex: mediumtext("fileIndex").notNull(),
  status: mysqlEnum("status", ["ready", "processing", "error"]).default("ready").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const chatMessages = mysqlTable("chatMessages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  threadId: int("threadId"),
  channelId: int("channelId"),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: mediumtext("content").notNull(),
  model: varchar("model", { length: 255 }),
  intent: varchar("intent", { length: 128 }),
  inputTokens: int("inputTokens"),
  outputTokens: int("outputTokens"),
  costMicrousd: int("costMicrousd"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const changeRequests = mysqlTable("changeRequests", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  instruction: text("instruction").notNull(),
  summary: mediumtext("summary").notNull(),
  proposalJson: mediumtext("proposalJson").notNull(),
  diffText: mediumtext("diffText").notNull(),
  status: mysqlEnum("status", ["proposed", "exported", "rejected"]).default("proposed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const projectArtifacts = mysqlTable("projectArtifacts", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  kind: mysqlEnum("kind", ["source", "export"]).notNull(),
  filename: varchar("filename", { length: 512 }).notNull(),
  storageKey: varchar("storageKey", { length: 1024 }).notNull(),
  storageUrl: varchar("storageUrl", { length: 2048 }).notNull(),
  bytes: int("bytes").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiChannels = mysqlTable("aiChannels", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  provider: mysqlEnum("provider", ["builtin", "openai", "groq", "openrouter", "puter", "custom"]).notNull(),
  modelIds: mediumtext("modelIds").notNull(),
  selectedModel: varchar("selectedModel", { length: 255 }),
  connectionState: mysqlEnum("connectionState", ["not_configured", "online", "offline"]).default("not_configured").notNull(),
  isEnabled: int("isEnabled").default(1).notNull(),
  lastLatencyMs: int("lastLatencyMs"),
  webFetchEnabled: int("webFetchEnabled").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const channelProfiles = mysqlTable("channelProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  channelId: int("channelId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  systemPrompt: mediumtext("systemPrompt"),
  temperature: int("temperature").default(20).notNull(),
  taskFocus: varchar("taskFocus", { length: 80 }).default("general").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const conversationThreads = mysqlTable("conversationThreads", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  parentThreadId: int("parentThreadId"),
  branchFromMessageId: int("branchFromMessageId"),
  title: varchar("title", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const promptTemplates = mysqlTable("promptTemplates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  template: mediumtext("template").notNull(),
  variables: varchar("variables", { length: 1024 }),
  isBuiltIn: int("isBuiltIn").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const conversationTags = mysqlTable("conversationTags", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  color: varchar("color", { length: 24 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const conversationTagLinks = mysqlTable("conversationTagLinks", {
  id: int("id").autoincrement().primaryKey(),
  threadId: int("threadId").notNull(),
  tagId: int("tagId").notNull(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const messageBookmarks = mysqlTable("messageBookmarks", {
  id: int("id").autoincrement().primaryKey(),
  messageId: int("messageId").notNull(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const messageAnnotations = mysqlTable("messageAnnotations", {
  id: int("id").autoincrement().primaryKey(),
  messageId: int("messageId").notNull(),
  userId: int("userId").notNull(),
  selectedText: text("selectedText").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const messageFeedback = mysqlTable("messageFeedback", {
  id: int("id").autoincrement().primaryKey(),
  messageId: int("messageId").notNull(),
  userId: int("userId").notNull(),
  rating: mysqlEnum("rating", ["up", "down"]).notNull(),
  reason: varchar("reason", { length: 128 }),
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const conversationSnapshots = mysqlTable("conversationSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  threadId: int("threadId"),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  stateJson: mediumtext("stateJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sharedConversationLinks = mysqlTable("sharedConversationLinks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  threadId: int("threadId"),
  token: varchar("token", { length: 48 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 128 }),
  isActive: int("isActive").default(1).notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiTraces = mysqlTable("aiTraces", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  messageId: int("messageId"),
  channelId: int("channelId"),
  model: varchar("model", { length: 255 }).notNull(),
  intent: varchar("intent", { length: 128 }).notNull(),
  outcome: mysqlEnum("outcome", ["success", "error", "cached"]).notNull(),
  latencyMs: int("latencyMs").notNull(),
  inputTokens: int("inputTokens"),
  outputTokens: int("outputTokens"),
  costMicrousd: int("costMicrousd"),
  detailJson: mediumtext("detailJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const commandQueueItems = mysqlTable("commandQueueItems", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  prompt: text("prompt").notNull(),
  conditionJson: text("conditionJson"),
  position: int("position").notNull(),
  status: mysqlEnum("status", ["pending", "running", "complete", "skipped", "error"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const intentPatterns = mysqlTable("intentPatterns", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  pattern: varchar("pattern", { length: 500 }).notNull(),
  matchType: mysqlEnum("matchType", ["keyword", "regex"]).notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const syncPreferences = mysqlTable("syncPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  provider: mysqlEnum("provider", ["managed", "puter"]).default("managed").notNull(),
  isEnabled: int("isEnabled").default(1).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChangeRequest = typeof changeRequests.$inferSelect;
export type ProjectArtifact = typeof projectArtifacts.$inferSelect;
export type AiChannel = typeof aiChannels.$inferSelect;
export type ChannelProfile = typeof channelProfiles.$inferSelect;
export type ConversationThread = typeof conversationThreads.$inferSelect;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type AiTrace = typeof aiTraces.$inferSelect;
