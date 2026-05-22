ALTER TABLE `UserSetting`
    MODIFY `language` VARCHAR(191) NOT NULL DEFAULT 'sv';

UPDATE `UserSetting`
SET `language` = CASE
    WHEN LOWER(TRIM(`language`)) IN ('english', 'en') THEN 'en'
    WHEN LOWER(TRIM(`language`)) IN ('swedish', 'sv', 'svenska') THEN 'sv'
    ELSE 'sv'
END;
