-- =================================================================
-- DEBUG TRIGGER SCRIPT
-- This script logs EVERY update to the 'cases' table, ignoring conditions.
-- Use this to verify that triggers are actually firing.
-- =================================================================

-- 1. Replace the Function with "Unconditional Logging"
CREATE OR REPLACE FUNCTION public.log_case_update()
RETURNS TRIGGER AS $$
DECLARE
    payload_data jsonb;
BEGIN
    -- LOG EVERYTHING (For Debugging)
    -- We removed the IF condition to see if the trigger fires at all.
    
    payload_data := jsonb_build_object(
        'status', NEW.status,
        'priority', NEW.priority,
        'debug_msg', 'Unconditional Log'
    );
    
    INSERT INTO public.notification_log (case_id, notification_day, sent_at, payload)
    VALUES (NEW.case_id, -1, NULL, payload_data);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Force Re-create the Trigger
DROP TRIGGER IF EXISTS on_case_update ON cases;

CREATE TRIGGER on_case_update
AFTER UPDATE ON cases FOR EACH ROW
EXECUTE FUNCTION log_case_update();


-- 3. TEST QUERY (You can run this manually to test)
-- Replace 'CASE_ID_HERE' with a valid UUID from your table
-- UPDATE cases SET status = 'PENDING' WHERE case_id = 'CASE_ID_HERE';
