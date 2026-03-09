-- CreateEnum
CREATE TYPE "SmtpTransportType" AS ENUM ('SMTP_AUTH', 'SMTP_API');

-- CreateEnum
CREATE TYPE "EmailTemplateType" AS ENUM ('DOCUMENT_INVITE', 'DOCUMENT_COMPLETED', 'DOCUMENT_PENDING', 'DOCUMENT_REJECTED', 'DOCUMENT_CANCELLED', 'RECIPIENT_SIGNED');

-- CreateTable
CREATE TABLE "OrganisationSmtpSettings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "transportType" "SmtpTransportType" NOT NULL DEFAULT 'SMTP_AUTH',
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 587,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "apiKeyUser" TEXT NOT NULL DEFAULT 'apikey',
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationSmtpSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationEmailTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "EmailTemplateType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationSmtpSettings_organisationId_key" ON "OrganisationSmtpSettings"("organisationId");

-- CreateIndex
CREATE INDEX "OrganisationEmailTemplate_organisationId_idx" ON "OrganisationEmailTemplate"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationEmailTemplate_organisationId_type_key" ON "OrganisationEmailTemplate"("organisationId", "type");

-- AddForeignKey
ALTER TABLE "OrganisationSmtpSettings" ADD CONSTRAINT "OrganisationSmtpSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationEmailTemplate" ADD CONSTRAINT "OrganisationEmailTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
