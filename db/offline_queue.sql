-- Create pending_notifications table (No changes to Users table needed)
CREATE TABLE IF NOT EXISTS public.pending_notifications (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pending_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT pending_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (user_id) ON DELETE CASCADE
) TABLESPACE pg_default;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_pending_notifications_user_id ON public.pending_notifications (user_id);
