-- CreateTable
CREATE TABLE "Project" (
    "cwdHash" TEXT NOT NULL PRIMARY KEY,
    "cwd" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectCwdHash" TEXT NOT NULL,
    "tool" TEXT NOT NULL DEFAULT 'claude-code',
    "startedAt" DATETIME NOT NULL,
    "lastActivityAt" DATETIME NOT NULL,
    "gitBranch" TEXT,
    "version" TEXT,
    "entrypoint" TEXT,
    "permissionMode" TEXT,
    "lastPrompt" TEXT,
    "summary" TEXT,
    CONSTRAINT "Session_projectCwdHash_fkey" FOREIGN KEY ("projectCwdHash") REFERENCES "Project" ("cwdHash") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tool" TEXT NOT NULL DEFAULT 'claude-code',
    "role" TEXT NOT NULL,
    "parentUuid" TEXT,
    "isSidechain" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" DATETIME NOT NULL,
    "content" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tool" TEXT NOT NULL DEFAULT 'claude-code',
    "type" TEXT NOT NULL,
    "relatedMessageUuid" TEXT,
    "observedAt" DATETIME NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "Attachment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionSource" (
    "tool" TEXT NOT NULL PRIMARY KEY,
    "rootPath" TEXT NOT NULL,
    "lastScannedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_cwd_key" ON "Project"("cwd");

-- CreateIndex
CREATE INDEX "Project_lastSeenAt_idx" ON "Project"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Session_projectCwdHash_idx" ON "Session"("projectCwdHash");

-- CreateIndex
CREATE INDEX "Session_lastActivityAt_idx" ON "Session"("lastActivityAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_parentUuid_idx" ON "ChatMessage"("sessionId", "parentUuid");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_timestamp_idx" ON "ChatMessage"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "Attachment_sessionId_observedAt_idx" ON "Attachment"("sessionId", "observedAt");

-- CreateIndex
CREATE INDEX "Attachment_relatedMessageUuid_idx" ON "Attachment"("relatedMessageUuid");
