-- ============================================================================
-- REALTIME NOTIFICATION TRIGGERS
-- Run this in Supabase SQL Editor to enable automatic notifications on update.
-- ============================================================================

-- 1. Create the Function to Log Updates
-- This function runs whenever a case is updated.
-- It inserts a log entry with notification_day = -1 (Code for "Generic Update")
CREATE OR REPLACE FUNCTION public.log_case_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert a log entry
  -- sent_at is NULL by default, so the Realtime Service picks it up.
  INSERT INTO public.notification_log (case_id, notification_day, sent_at)
  VALUES (NEW.case_id, -1, NULL); 
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create the Trigger on the Cases Table
-- Fires AFTER any UPDATE on the 'cases' table.
DROP TRIGGER IF EXISTS on_case_update ON public.cases;
CREATE TRIGGER on_case_update
AFTER UPDATE ON public.cases
FOR EACH ROW
EXECUTE FUNCTION public.log_case_update();

-- 3. Create Function to Log Assignments
-- This runs when a new row is added to 'case_users' (Officer assigned)
CREATE OR REPLACE FUNCTION public.log_case_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert a log entry with notification_day = -2 (Code for "New Assignment")
  INSERT INTO public.notification_log (case_id, notification_day, sent_at)
  VALUES (NEW.case_id, -2, NULL); 
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create Trigger on case_users
DROP TRIGGER IF EXISTS on_case_assignment ON public.case_users;
CREATE TRIGGER on_case_assignment
AFTER INSERT ON public.case_users
FOR EACH ROW
EXECUTE FUNCTION public.log_case_assignment();

-- ============================================================================
-- NOTE: ENABLE REPLICATION
-- You MUST enable Replication for the 'notification_log' table in Supabase Dashboard
-- (Database -> Replication -> Source: notification_log -> Toggle ON)
-- ============================================================================
