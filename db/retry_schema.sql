-- ============================================================================
-- RETRY & DELETE LOGIC SCHEMA
-- Run this in Supabase SQL Editor.
-- ============================================================================

-- 1. Add Retry Tracking Columns
ALTER TABLE public.notification_log 
ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE;
