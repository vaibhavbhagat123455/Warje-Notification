-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. UTILITY FUNCTIONS
-- ==========================================

-- Function to update 'updated_at' column automatically
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log generic case updates (Status/Priority changes)
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

-- Function to log new case assignments
CREATE OR REPLACE FUNCTION public.log_case_assignment()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.notification_log (case_id, notification_day, sent_at)
    VALUES (NEW.case_id, -2, NULL);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 2. TABLE DEFINITIONS
-- ==========================================

create table public.cases (
  case_id uuid not null default extensions.uuid_generate_v4 (),
  created_at timestamp with time zone not null default now(),
  case_number text not null,
  title text not null,
  priority public.case_priority_enum not null,
  section_under_ipc text null,
  deadline date null,
  status public.case_status_enum not null default 'PENDING'::case_status_enum,
  updated_at timestamp with time zone null default now(),
  is_deleted boolean null default false,
  deleted_at timestamp with time zone null,
  constraint cases_pkey primary key (case_id),
  constraint cases_case_number_key unique (case_number)
) TABLESPACE pg_default;

create table public.case_users (
  case_id uuid not null,
  user_id uuid not null,
  constraint case_users_pkey primary key (case_id, user_id),
  constraint case_users_case_id_fkey foreign KEY (case_id) references cases (case_id) on delete CASCADE,
  constraint case_users_user_id_fkey foreign KEY (user_id) references users (user_id) on delete CASCADE
) TABLESPACE pg_default;

create table public.notification_log (
  log_id uuid not null default extensions.uuid_generate_v4 (),
  case_id uuid null,
  notification_day integer null,
  sent_at timestamp with time zone null default now(),
  payload jsonb null,
  retry_count integer null default 0,
  last_attempt_at timestamp with time zone null,
  constraint notification_log_pkey primary key (log_id),
  constraint notification_log_case_id_fkey foreign KEY (case_id) references cases (case_id) on delete CASCADE
) TABLESPACE pg_default;

create table public.temp_users (
  temp_user_id uuid not null default extensions.uuid_generate_v4 (),
  name text not null,
  rank text null,
  email_id text not null,
  password text not null,
  created_at timestamp with time zone null default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone null default CURRENT_TIMESTAMP,
  constraint t_users_pkey primary key (temp_user_id),
  constraint t_users_email_id_key unique (email_id),
  constraint t_users_email_check check (
    (
      email_id ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text
    )
  ),
  constraint t_users_name_check check (
    (
      (
        length(TRIM(both from name)) >= 2
      )
      and (
        length(TRIM(both from name)) <= 20
      )
    )
  ),
  constraint t_users_rank_check check (
    (
      rank = any (
        array[
          'CONSTABLE'::text,
          'SENIOR INSPECTOR'::text,
          'INSPECTOR'::text,
          'INVESTIGATING OFFICER'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create table public.temp_users_otp (
  temp_id uuid not null default extensions.uuid_generate_v4 (),
  email_id text not null,
  code text not null,
  expiry_time timestamp with time zone not null,
  purpose text null,
  constraint temp_users_pkey primary key (temp_id),
  constraint temp_users_email_id_key unique (email_id),
  constraint t_otp_code_check check ((length(code) = 4)),
  constraint t_otp_email_check check (
    (
      email_id ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text
    )
  ),
  constraint t_otp_purpose_check check (
    (
      purpose = any (
        array[
          'SIGNIN'::text,
          'SIGNUP'::text,
          'RESET_PASSWORD'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create table public.users (
  user_id uuid not null default extensions.uuid_generate_v4 (),
  name text not null,
  rank text null,
  email_id text not null,
  password text not null,
  role text not null default 'USER'::text,
  created_at timestamp with time zone null default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone null default CURRENT_TIMESTAMP,
  is_deleted boolean not null default false,
  deleted_at timestamp with time zone null,
  fcm_token text null,
  constraint users_pkey primary key (user_id),
  constraint users_email_id_key unique (email_id),
  constraint users_name_check check (
    (
      (
        length(TRIM(both from name)) >= 2
      )
      and (
        length(TRIM(both from name)) <= 20
      )
    )
  ),
  constraint users_rank_check check (
    (
      rank = any (
        array[
          'CONSTABLE'::text,
          'SENIOR INSPECTOR'::text,
          'INSPECTOR'::text,
          'INVESTIGATING OFFICER'::text
        ]
      )
    )
  ),
  constraint users_role_check check ((role = any (array['ADMIN'::text, 'USER'::text])))
) TABLESPACE pg_default;


-- ==========================================
-- 3. TRIGGERS
-- ==========================================

-- Trigger for Case Updates (Status/Priority)
create trigger on_case_update
after update on cases for EACH row
execute FUNCTION log_case_update ();

-- Trigger for Case Updated At Timestamp
create trigger update_cases_updated_at BEFORE
update on cases for EACH row
execute FUNCTION update_updated_at_column ();

-- Trigger for Case Assignments
create trigger on_case_assignment
after INSERT on case_users for EACH row
execute FUNCTION log_case_assignment ();

-- Trigger for Temp Users Updated At
create trigger update_temp_users_updated_at BEFORE
update on temp_users for EACH row
execute FUNCTION update_updated_at_column ();

-- Trigger for Users Updated At
create trigger update_users_updated_at BEFORE
update on users for EACH row
execute FUNCTION update_updated_at_column ();

-- TRIGGER FOR NOTIFICATIONS (WEBHOOK CALL)
-- Calls Vercel Webhook when a log entry is created
create trigger "notification-trigger"
after INSERT on notification_log for EACH row
execute FUNCTION supabase_functions.http_request (
  'https://warje-notification.vercel.app/api/notifications/webhook',
  'POST',
  '{"Content-type":"application/json"}',
  '{}',
  '5000'
);
