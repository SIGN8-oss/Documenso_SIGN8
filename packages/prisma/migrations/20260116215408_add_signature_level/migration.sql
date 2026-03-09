-- CreateEnum
CREATE TYPE "SignatureLevel" AS ENUM ('SES', 'AES', 'QES');

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "signatureLevel" "SignatureLevel" NOT NULL DEFAULT 'SES';

-- AlterTable
ALTER TABLE "Signature" ADD COLUMN     "sign8SignatureData" TEXT,
ADD COLUMN     "signatureLevel" "SignatureLevel";
