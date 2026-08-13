-- P2: 数据库冗余字段/索引清理脚本
-- 说明：在执行前务必对远端数据库做 mysqldump 备份并在测试库验证。
-- 该脚本在支持 IF EXISTS 的 MySQL/MariaDB 上更安全；若目标库不支持 IF EXISTS，请先在测试库按顺序执行或去掉 IF EXISTS 并谨慎运行。

START TRANSACTION;

-- 1) 删除 orders 中永远写空/默认但未被读取的列
ALTER TABLE orders DROP COLUMN IF EXISTS table_number;
ALTER TABLE orders DROP COLUMN IF EXISTS guest_count;
ALTER TABLE orders DROP COLUMN IF EXISTS meal_period;

-- 2) 删除 order_items 中恒为 1 或未被读取的列
ALTER TABLE order_items DROP COLUMN IF EXISTS quantity;
ALTER TABLE order_items DROP COLUMN IF EXISTS created_at;

-- 3) 删除 favorites 的 created_at（未被读取）
ALTER TABLE favorites DROP COLUMN IF EXISTS created_at;

-- 4) 删除 messages 的 meal_period（餐次功能已下线）
ALTER TABLE messages DROP COLUMN IF EXISTS meal_period;
ALTER TABLE messages DROP INDEX IF EXISTS idx_messages_period;

-- 5) 删除 dishes 的冗余列（meal_periods、sales、is_custom）
ALTER TABLE dishes DROP COLUMN IF EXISTS meal_periods;
ALTER TABLE dishes DROP COLUMN IF EXISTS sales;
ALTER TABLE dishes DROP COLUMN IF EXISTS is_custom;

-- 6) 删除不再使用的索引
ALTER TABLE dishes DROP INDEX IF EXISTS idx_dishes_name;
ALTER TABLE dishes DROP INDEX IF EXISTS idx_dishes_category;
ALTER TABLE orders DROP INDEX IF EXISTS idx_orders_status_period;
ALTER TABLE messages DROP INDEX IF EXISTS idx_messages_created_at; -- 可选：按需保留

-- 7) 一次性存量数据清理（按 P2 建议）
DELETE FROM orders WHERE status != 'completed';
DELETE oi FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL;

COMMIT;

-- 建议：清理完成后，导出新的 sql/hewei_order.sql（schema dump）以便与代码同步。