-- AlterTable
ALTER TABLE `ChatMessage` ADD COLUMN `attachmentType` VARCHAR(191) NULL,
    ADD COLUMN `attachmentUrl` LONGTEXT NULL,
    ADD COLUMN `durationSeconds` INTEGER NULL,
    ADD COLUMN `fileKey` VARCHAR(191) NULL,
    ADD COLUMN `fileSize` INTEGER NULL,
    ADD COLUMN `mimeType` VARCHAR(191) NULL,
    ADD COLUMN `thumbnailUrl` LONGTEXT NULL;
