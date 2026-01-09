-- ============================================================================
-- DETAILED NOTIFICATIONS (With JSON Payload)
-- Run this in Supabase SQL Editor.
-- ============================================================================

-- 1. Add Payload Column to Notification Log
-- We use JSONB to store flexible data about the change
ALTER TABLE public.notification_log 
ADD COLUMN IF NOT EXISTS payload JSONB;

-- 2. Update Function: Log Case Updates
CREATE OR REPLACE FUNCTION public.log_case_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert log with payload = The NEW row data
  INSERT INTO public.notification_log (case_id, notification_day, sent_at, payload)
  VALUES (NEW.case_id, -1, NULL, row_to_json(NEW)::jsonb); 
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update Function: Log Assignments
CREATE OR REPLACE FUNCTION public.log_case_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert log with payload = The NEW assignment data
  INSERT INTO public.notification_log (case_id, notification_day, sent_at, payload)
  VALUES (NEW.case_id, -2, NULL, row_to_json(NEW)::jsonb); 
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create triggers to ensure they use the latest functions
DROP TRIGGER IF EXISTS on_case_update ON public.cases;
CREATE TRIGGER on_case_update
AFTER UPDATE ON public.cases
FOR EACH ROW
EXECUTE FUNCTION public.log_case_update();

DROP TRIGGER IF EXISTS on_case_assignment ON public.case_users;
CREATE TRIGGER on_case_assignment
AFTER INSERT ON public.case_users
FOR EACH ROW
EXECUTE FUNCTION public.log_case_assignment();
