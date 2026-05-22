-- AlterTable
ALTER TABLE `Blog` MODIFY `title` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `Post` MODIFY `caption` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `Vlog` MODIFY `title` LONGTEXT NOT NULL,
    MODIFY `description` LONGTEXT NOT NULL;
