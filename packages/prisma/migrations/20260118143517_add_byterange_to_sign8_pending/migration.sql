-- AlterTable
ALTER TABLE "Signature" ADD COLUMN     "sign8CredentialId" TEXT,
ADD COLUMN     "sign8PendingSignatureId" TEXT;

-- CreateTable
CREATE TABLE "Sign8QESPendingSignature" (
    "id" TEXT NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "preparedPdfData" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "byteRange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sign8QESPendingSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sign8QESPendingSignature_recipientId_key" ON "Sign8QESPendingSignature"("recipientId");

-- AddForeignKey
ALTER TABLE "Sign8QESPendingSignature" ADD CONSTRAINT "Sign8QESPendingSignature_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
