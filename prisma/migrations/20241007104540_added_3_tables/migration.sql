-- CreateTable
CREATE TABLE `ReactBlogComment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `BlogCommentId` INTEGER NOT NULL,
    `createByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReactCommentPost` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `CommentPostId` INTEGER NOT NULL,
    `createByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReactCommentVlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `CommentVlogId` INTEGER NOT NULL,
    `createByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReactBlogComment` ADD CONSTRAINT `ReactBlogComment_BlogCommentId_fkey` FOREIGN KEY (`BlogCommentId`) REFERENCES `BlogComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReactBlogComment` ADD CONSTRAINT `ReactBlogComment_createByUserId_fkey` FOREIGN KEY (`createByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReactCommentPost` ADD CONSTRAINT `ReactCommentPost_CommentPostId_fkey` FOREIGN KEY (`CommentPostId`) REFERENCES `CommentPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReactCommentPost` ADD CONSTRAINT `ReactCommentPost_createByUserId_fkey` FOREIGN KEY (`createByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReactCommentVlog` ADD CONSTRAINT `ReactCommentVlog_CommentVlogId_fkey` FOREIGN KEY (`CommentVlogId`) REFERENCES `CommentVlog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReactCommentVlog` ADD CONSTRAINT `ReactCommentVlog_createByUserId_fkey` FOREIGN KEY (`createByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
