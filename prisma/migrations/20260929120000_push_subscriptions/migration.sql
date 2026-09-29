-- Browser-Push: Abos je Geraet und Versandvermerk je Empfaenger.
-- Rein additiv. Bestehende Empfaengerzeilen gelten als erledigt, damit nach
-- dem ersten Abo keine alten Mitteilungen nachgeschickt werden.

-- AlterTable
ALTER TABLE "message_recipients" ADD COLUMN     "pushedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


UPDATE "message_recipients" SET "pushedAt" = CURRENT_TIMESTAMP;

-- Offene Zeilen fuer den Hintergrundlauf (Teilindex, in schema.prisma nicht abbildbar).
CREATE INDEX "message_recipients_push_pending_idx" ON "message_recipients"("userId") WHERE "pushedAt" IS NULL;
