import { supabase } from '../config/supabase.js';
import { sendNotificationForCase } from './notification.service.js';

export const initRealtimeListener = () => {
    console.log('Initializing Realtime Listener for notification_log...');

    supabase
        .channel('notification-logger')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notification_log' },
            async (payload) => {
                const { log_id, case_id, notification_day, sent_at, payload: logPayload } = payload.new;

                // Optimization: If sent_at is already set (unlikely for new pending logs), skip.
                if (sent_at) return;

                console.log(`⚡ Realtime Event: New Notification Log [${log_id}] for Case [${case_id}]`);

                // 1. Send the Notification
                // We await this so we don't mark as sent until we try.
                // Pass log_id to allow service to Delete or Retry
                await sendNotificationForCase(case_id, notification_day, logPayload, log_id);

                // 2. Mark as Sent
                // This prevents the Cron Job (which runs every min) from picking it up again
                // if it hasn't run yet.
                await supabase
                    .from('notification_log')
                    .update({ sent_at: new Date() })
                    .eq('log_id', log_id);

                console.log(`✅ Realtime: Log [${log_id}] marked as processed.`);
            }
        )
        .subscribe((status) => {
            console.log(`Realtime Subscription Status: ${status}`);
        });
};
