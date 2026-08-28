CREATE TABLE `aiChannels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`provider` enum('builtin','openai','groq','openrouter','puter','custom') NOT NULL,
	`modelIds` mediumtext NOT NULL,
	`selectedModel` varchar(255),
	`connectionState` enum('not_configured','online','offline') NOT NULL DEFAULT 'not_configured',
	`lastLatencyMs` int,
	`webFetchEnabled` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiChannels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `aiTraces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`messageId` int,
	`channelId` int,
	`model` varchar(255) NOT NULL,
	`intent` varchar(128) NOT NULL,
	`outcome` enum('success','error','cached') NOT NULL,
	`latencyMs` int NOT NULL,
	`inputTokens` int,
	`outputTokens` int,
	`costMicrousd` int,
	`detailJson` mediumtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiTraces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `channelProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`channelId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`systemPrompt` mediumtext,
	`temperature` int NOT NULL DEFAULT 20,
	`taskFocus` varchar(80) NOT NULL DEFAULT 'general',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channelProfiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `commandQueueItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`prompt` text NOT NULL,
	`conditionJson` text,
	`position` int NOT NULL,
	`status` enum('pending','running','complete','skipped','error') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commandQueueItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversationSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`threadId` int,
	`userId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`stateJson` mediumtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversationSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversationTagLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` int NOT NULL,
	`tagId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversationTagLinks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversationTags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`color` varchar(24) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversationTags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversationThreads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`parentThreadId` int,
	`branchFromMessageId` int,
	`title` varchar(255) NOT NULL,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversationThreads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intentPatterns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`label` varchar(100) NOT NULL,
	`pattern` varchar(500) NOT NULL,
	`matchType` enum('keyword','regex') NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `intentPatterns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messageAnnotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`userId` int NOT NULL,
	`selectedText` text NOT NULL,
	`note` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messageAnnotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messageBookmarks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messageBookmarks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messageFeedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`userId` int NOT NULL,
	`rating` enum('up','down') NOT NULL,
	`reason` varchar(128),
	`comment` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messageFeedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `promptTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`category` varchar(80) NOT NULL,
	`template` mediumtext NOT NULL,
	`variables` varchar(1024),
	`isBuiltIn` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `promptTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sharedConversationLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`threadId` int,
	`token` varchar(48) NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sharedConversationLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `sharedConversationLinks_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `syncPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('managed','puter') NOT NULL DEFAULT 'managed',
	`isEnabled` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `syncPreferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `syncPreferences_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `threadId` int;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `channelId` int;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `model` varchar(255);--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `intent` varchar(128);--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `inputTokens` int;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `outputTokens` int;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD `costMicrousd` int;