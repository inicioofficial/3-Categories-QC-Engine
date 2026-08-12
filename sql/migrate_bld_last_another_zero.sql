-- Migration: Move existing bld_last_another = 0 records to deleted_listing_long
-- This script moves existing listing records where bld_last_another = 0 from hh_listing_long
-- to the clean.deleted_listing_long table, then deletes them from the main table.

-- Step 1: Check how many records will be affected
SELECT COUNT(*) AS records_to_delete
FROM clean.hh_listing_long
WHERE COALESCE(record->>'bld_last_another', '1') IN ('0', '0.0');

-- Step 2: Migrate records to deleted_listing_long table
INSERT INTO clean.deleted_listing_long (
    submission_key,
    caseid,
    ea_id,
    enumerator_id,
    deleted_at,
    deleted_by,
    reason,
    record
)
SELECT
    l.submission_key,
    l.record->>'caseid' AS caseid,
    l.ea_id,
    l.record->>'enumerator_id' AS enumerator_id,
    NOW() AS deleted_at,
    'system_migration' AS deleted_by,
    'bld_last_another = 0' AS reason,
    l.record
FROM clean.hh_listing_long l
WHERE COALESCE(l.record->>'bld_last_another', '1') IN ('0', '0.0');

-- Step 3: Delete the migrated records from hh_listing_long
DELETE FROM clean.hh_listing_long
WHERE COALESCE(record->>'bld_last_another', '1') IN ('0', '0.0');

-- Step 4: Verify the deletion
SELECT COUNT(*) AS remaining_records_with_zero
FROM clean.hh_listing_long
WHERE COALESCE(record->>'bld_last_another', '1') IN ('0', '0.0');