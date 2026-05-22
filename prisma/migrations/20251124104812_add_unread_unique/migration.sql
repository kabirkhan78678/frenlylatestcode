/*
  Warnings:

  - A unique constraint covering the columns `[userId,chatId]` on the table `UnreadCount` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `userId_chatId_unique` ON `UnreadCount`(`userId`, `chatId`);
