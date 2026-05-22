-- AlterTable
ALTER TABLE `Blog` ADD COLUMN `fileKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Post` ADD COLUMN `fileKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `coverfileKey` VARCHAR(191) NULL,
    ADD COLUMN `fileKey` VARCHAR(191) NULL,
    ADD COLUMN `status` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Vlog` ADD COLUMN `fileKey` VARCHAR(191) NULL,
    ADD COLUMN `thumbnailfileKey` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ReportUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportedByUserId` INTEGER NOT NULL,
    `reportedToUserId` INTEGER NOT NULL,
    `reason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportBlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportedByUserId` INTEGER NOT NULL,
    `reportedToBlogId` INTEGER NOT NULL,
    `reason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportVlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportedByUserId` INTEGER NOT NULL,
    `reportedToVlogId` INTEGER NOT NULL,
    `reason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportPost` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportedByUserId` INTEGER NOT NULL,
    `reportedToPostId` INTEGER NOT NULL,
    `reason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Admin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `phone_no` VARCHAR(191) NULL,
    `full_name` VARCHAR(191) NULL,
    `password` VARCHAR(191) NOT NULL,
    `otp` VARCHAR(191) NULL,
    `fcm_token` VARCHAR(191) NULL,
    `token` VARCHAR(191) NULL,

    UNIQUE INDEX `Admin_email_key`(`email`),
    UNIQUE INDEX `Admin_phone_no_key`(`phone_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReportUser` ADD CONSTRAINT `ReportUser_reportedToUserId_fkey` FOREIGN KEY (`reportedToUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportBlog` ADD CONSTRAINT `ReportBlog_reportedToBlogId_fkey` FOREIGN KEY (`reportedToBlogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportBlog` ADD CONSTRAINT `ReportBlog_reportedByUserId_fkey` FOREIGN KEY (`reportedByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportVlog` ADD CONSTRAINT `ReportVlog_reportedToVlogId_fkey` FOREIGN KEY (`reportedToVlogId`) REFERENCES `Vlog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportVlog` ADD CONSTRAINT `ReportVlog_reportedByUserId_fkey` FOREIGN KEY (`reportedByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportPost` ADD CONSTRAINT `ReportPost_reportedToPostId_fkey` FOREIGN KEY (`reportedToPostId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportPost` ADD CONSTRAINT `ReportPost_reportedByUserId_fkey` FOREIGN KEY (`reportedByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
