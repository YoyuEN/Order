#!/usr/bin/env bash
set -euo pipefail

# P2 cleanup helper
# Usage: ./scripts/p2_cleanup.sh -h host -u user -d database [-P port]
# Requires mysql client installed. Prefer running in a maintenance window.

show_usage() {
  cat <<'USAGE'
Usage: p2_cleanup.sh -h HOST -u USER -d DATABASE [-P PORT]

This script will:
  - Suggest taking a mysqldump backup (it will not perform the backup automatically).
  - Run data cleanup (DELETE inactive orders and orphaned order_items).
  - Check for and DROP unused indexes and columns only if they exist.

Important:
  - ALTER/DROP operations cause implicit commits and may lock tables.
  - Test in a staging DB first. Have a verified backup before running in production.
USAGE
}

HOST=""
USER=""
DB=""
PORT=3306

while getopts ":h:u:d:P:p" opt; do
  case ${opt} in
    h) HOST=$OPTARG ;;
    u) USER=$OPTARG ;;
    d) DB=$OPTARG ;;
    P) PORT=$OPTARG ;;
    p) ;; # placeholder if someone passes -p for password; we'll prompt
    *) show_usage ; exit 1 ;;
  esac
done

if [ -z "$HOST" ] || [ -z "$USER" ] || [ -z "$DB" ]; then
  show_usage
  exit 1
fi

# If MYSQL_PWD is not set, prompt for the password (hidden)
if [ -z "${MYSQL_PWD-}" ]; then
  read -s -p "Enter DB password for ${USER}@${HOST}: " MYSQL_PWD
  echo
  export MYSQL_PWD
fi

MYSQL_OPTS=( -h"${HOST}" -P"${PORT}" -u"${USER}" "${DB}" )

confirm() {
  read -p "$1 [type YES to proceed]: " ok
  if [ "$ok" != "YES" ]; then
    echo "Cancelled by user."; exit 1
  fi
}

echo "IMPORTANT: Ensure you have a backup (mysqldump) before continuing."
echo "Suggested backup command (run in a separate shell):"
echo "  mysqldump -h ${HOST} -P ${PORT} -u ${USER} -p ${DB} > hewei_order_backup.sql"
confirm "If you already took a backup and want to proceed"

# Helper to run a query and return single value
run_query() {
  local q="$1"
  mysql "${MYSQL_OPTS[@]}" -N -s -e "$q"
}

# 2) Data cleanup
echo "\n=== Running data cleanup (DELETE non-completed orders, remove orphaned order_items) ==="
mysql "${MYSQL_OPTS[@]}" -e "DELETE FROM orders WHERE status != 'completed'; SELECT ROW_COUNT() AS affected;"
mysql "${MYSQL_OPTS[@]}" -e "DELETE oi FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL; SELECT ROW_COUNT() AS affected;"

# 3) Index deletion helper
drop_index_if_exists() {
  local table="$1" index="$2"
  echo "Checking index ${index} on ${table}..."
  local cnt
  cnt=$(run_query "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND INDEX_NAME = '${index}';")
  if [ "${cnt}" -gt 0 ]; then
    echo "Dropping index ${index} on ${table}..."
    mysql "${MYSQL_OPTS[@]}" -e "ALTER TABLE \\`${table}\\` DROP INDEX \\`${index}\\`;"
  else
    echo "Index ${index} not present, skipping."
  fi
}

# 4) Column deletion helper
drop_column_if_exists() {
  local table="$1" column="$2"
  echo "Checking column ${column} on ${table}..."
  local cnt
  cnt=$(run_query "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}';")
  if [ "${cnt}" -gt 0 ]; then
    echo "Dropping column ${column} on ${table}..."
    mysql "${MYSQL_OPTS[@]}" -e "ALTER TABLE \\`${table}\\` DROP COLUMN \\`${column}\\`;"
  else
    echo "Column ${column} not present, skipping."
  fi
}

# Indexes to consider removing
echo "\n=== Checking and dropping suggested indexes (if present) ==="
drop_index_if_exists "dishes" "idx_dishes_name"
drop_index_if_exists "dishes" "idx_dishes_category"
drop_index_if_exists "messages" "idx_messages_period"
drop_index_if_exists "messages" "idx_messages_created_at"  # optional: remove if you decide to

# Columns to consider removing
echo "\n=== Checking and dropping suggested columns (if present) ==="
# orders
drop_column_if_exists "orders" "table_number"
drop_column_if_exists "orders" "guest_count"
drop_column_if_exists "orders" "meal_period"
# order_items
drop_column_if_exists "order_items" "created_at"
# favorites
drop_column_if_exists "favorites" "created_at"
# messages
drop_column_if_exists "messages" "meal_period"
# dishes
drop_column_if_exists "dishes" "meal_periods"
drop_column_if_exists "dishes" "sales"
drop_column_if_exists "dishes" "is_custom"

# Final verification
echo "\n=== Final verification: show create table for key tables ==="
mysql "${MYSQL_OPTS[@]}" -e "SHOW CREATE TABLE \`dishes\`\G"
mysql "${MYSQL_OPTS[@]}" -e "SHOW CREATE TABLE \`orders\`\G"
mysql "${MYSQL_OPTS[@]}" -e "SHOW CREATE TABLE \`order_items\`\G"
mysql "${MYSQL_OPTS[@]}" -e "SHOW CREATE TABLE \`messages\`\G"
mysql "${MYSQL_OPTS[@]}" -e "SHOW CREATE TABLE \`favorites\`\G"

echo "\nP2 cleanup script finished. Please export new schema (mysqldump --no-data) and update sql/hewei_order.sql in the repo if everything looks good."
