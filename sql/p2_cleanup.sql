-- P2: 数据库冗余字段/索引清理脚本 (兼容不支持 IF EXISTS 的 MySQL 版本)
-- 说明：在执行前务必对远端数据库做 mysqldump 备份并在测试库验证。
-- 该脚本通过查询 INFORMATION_SCHEMA 条件执行 ALTER/DROP，避免在不支持 IF EXISTS 的版本报错.

-- 注意：ALTER TABLE / DROP INDEX 会导致隐式提交，无法在事务中回滚，请在测试库验证。

-- 删除 orders.table_number
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'table_number';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `orders` DROP COLUMN `table_number`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 删除 orders.guest_count
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'guest_count';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `orders` DROP COLUMN `guest_count`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 删除 orders.meal_period
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'meal_period';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `orders` DROP COLUMN `meal_period`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- order_items.quantity
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'quantity';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `order_items` DROP COLUMN `quantity`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- order_items.created_at
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'created_at';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `order_items` DROP COLUMN `created_at`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- favorites.created_at
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'favorites' AND COLUMN_NAME = 'created_at';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `favorites` DROP COLUMN `created_at`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- messages.meal_period
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'meal_period';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `messages` DROP COLUMN `meal_period`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dishes.meal_periods
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dishes' AND COLUMN_NAME = 'meal_periods';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `dishes` DROP COLUMN `meal_periods`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dishes.sales
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dishes' AND COLUMN_NAME = 'sales';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `dishes` DROP COLUMN `sales`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dishes.is_custom
SELECT COUNT(*) INTO @cnt FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dishes' AND COLUMN_NAME = 'is_custom';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `dishes` DROP COLUMN `is_custom`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 删除索引的条件执行
-- idx_dishes_name
SELECT COUNT(*) INTO @cnt FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dishes' AND INDEX_NAME = 'idx_dishes_name';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `dishes` DROP INDEX `idx_dishes_name`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_dishes_category
SELECT COUNT(*) INTO @cnt FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dishes' AND INDEX_NAME = 'idx_dishes_category';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `dishes` DROP INDEX `idx_dishes_category`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_orders_status_period
SELECT COUNT(*) INTO @cnt FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_status_period';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `orders` DROP INDEX `idx_orders_status_period`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_messages_period
SELECT COUNT(*) INTO @cnt FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND INDEX_NAME = 'idx_messages_period';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `messages` DROP INDEX `idx_messages_period`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 可选：删除 messages.created_at 索引（按需）
SELECT COUNT(*) INTO @cnt FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND INDEX_NAME = 'idx_messages_created_at';
SET @stmt = IF(@cnt > 0, 'ALTER TABLE `messages` DROP INDEX `idx_messages_created_at`', 'SELECT 0');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 一次性存量数据清理（按 P2 建议）
DELETE FROM orders WHERE status != 'completed';
DELETE oi FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL;

-- 建议：清理完成后，导出新的 sql/hewei_order.sql（schema dump）以便与代码同步。
