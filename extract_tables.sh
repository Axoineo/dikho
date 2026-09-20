#!/bin/bash
echo "-- Migration: vendors dependencies" > supabase/migrations/20260903_vendors.sql
echo "" >> supabase/migrations/20260903_vendors.sql

# Extract tables
for table in media sub_media vendors vendor_addresses; do
  awk "/CREATE TABLE IF NOT EXISTS \\\"public\\\".\\\"$table\\\" \\(/,/\\);/" remote_schema.sql >> supabase/migrations/20260903_vendors.sql
  echo "" >> supabase/migrations/20260903_vendors.sql
done

# Extract sequences
for table in media sub_media vendors vendor_addresses; do
  grep -i "CREATE SEQUENCE IF NOT EXISTS \\\"public\\\".\\\"${table}_id_seq\\\"" remote_schema.sql >> supabase/migrations/20260903_vendors.sql
  grep -i "ALTER SEQUENCE \\\"public\\\".\\\"${table}_id_seq\\\" OWNED BY \\\"public\\\".\\\"${table}\\\".\\\"id\\\"" remote_schema.sql >> supabase/migrations/20260903_vendors.sql
  grep -i "ALTER TABLE ONLY \\\"public\\\".\\\"${table}\\\" ALTER COLUMN \\\"id\\\" SET DEFAULT" remote_schema.sql >> supabase/migrations/20260903_vendors.sql
  echo "" >> supabase/migrations/20260903_vendors.sql
done

# Extract primary keys
for table in media sub_media vendors vendor_addresses; do
  grep -A 1 "ALTER TABLE ONLY \\\"public\\\".\\\"${table}\\\"" remote_schema.sql | grep -B 1 "PRIMARY KEY" >> supabase/migrations/20260903_vendors.sql
  echo "" >> supabase/migrations/20260903_vendors.sql
done

# Extract foreign keys
for table in media sub_media vendors vendor_addresses; do
  grep -A 1 "ALTER TABLE ONLY \\\"public\\\".\\\"${table}\\\"" remote_schema.sql | grep -B 1 "FOREIGN KEY" >> supabase/migrations/20260903_vendors.sql
  echo "" >> supabase/migrations/20260903_vendors.sql
done

