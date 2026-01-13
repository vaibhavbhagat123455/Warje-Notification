-- =================================================================
-- SAFE UPDATE SCRIPT
-- Run this to update Functions and Triggers WITHOUT deleting Tables
-- =================================================================

-- 1. UTILITY FUNCTIONS (Create or Replace)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.log_case_update()
RETURNS TRIGGER AS $$
DECLARE
    payload_data jsonb;
BEGIN
    -- Only log if significant fields changed
    IF (OLD.status IS DISTINCT FROM NEW.status) OR (OLD.priority IS DISTINCT FROM NEW.priority) THEN
        payload_data := jsonb_build_object(
            'status', NEW.status,
            'priority', NEW.priority
        );
        
        INSERT INTO public.notification_log (case_id, notification_day, sent_at, payload)
        VALUES (NEW.case_id, -1, NULL, payload_data);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.log_case_assignment()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.notification_log (case_id, notification_day, sent_at)
    VALUES (NEW.case_id, -2, NULL);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. TRIGGERS (Drop first to avoid errors, then Re-create)

-- A. Case Updates
DROP TRIGGER IF EXISTS on_case_update ON cases;
CREATE TRIGGER on_case_update
AFTER UPDATE ON cases FOR EACH ROW
EXECUTE FUNCTION log_case_update();

DROP TRIGGER IF EXISTS update_cases_updated_at ON cases;
CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON cases
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- B. Case Assignments
DROP TRIGGER IF EXISTS on_case_assignment ON case_users;
CREATE TRIGGER on_case_assignment
AFTER INSERT ON case_users FOR EACH ROW
EXECUTE FUNCTION log_case_assignment();

-- C. User Updates (Timestamps)
DROP TRIGGER IF EXISTS update_temp_users_updated_at ON temp_users;
CREATE TRIGGER update_temp_users_updated_at BEFORE UPDATE ON temp_users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- D. NOTIFICATIONS WEBHOOK (The Critical Part)
DROP TRIGGER IF EXISTS "notification-trigger" ON notification_log;
CREATE TRIGGER "notification-trigger"
AFTER INSERT ON notification_log FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  'https://warje-notification.vercel.app/api/notifications/webhook',
  'POST',
  '{"Content-type":"application/json"}',
  '{}',
  '5000'
);
