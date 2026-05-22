-- AlterTable
ALTER TABLE `BlogComment` ADD COLUMN `numberOfLikes` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `CommentPost` ADD COLUMN `numberOfLikes` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `CommentVlog` ADD COLUMN `numberOfLikes` INTEGER NOT NULL DEFAULT 0;
