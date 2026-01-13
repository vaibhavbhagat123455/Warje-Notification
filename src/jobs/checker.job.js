import cron from 'node-cron';
import { supabase } from '../config/supabase.js';

// Run every minute for testing, or likely daily in production (e.g., '0 9 * * *')
// For "Real-time" feel as user requested, we run frequently.
cron.schedule('*/2 * * * *', async () => {
    console.log('--- Running Due Date Checker ---');
    try {
        // 1. Call RPC to get due notifications
        const { data: notificationsDue, error: rpcError } = await supabase
            .rpc('check_and_send_notifications');

        if (rpcError) {
            console.error('RPC Error:', rpcError);
            return;
        }

        if (!notificationsDue || notificationsDue.length === 0) {
            console.log('No due notifications found.');
            return;
        }

        console.log(`Found ${notificationsDue.length} due notifications.`);

        const logEntries = [];
        const seen = new Set();

        for (const item of notificationsDue) {
            // Deduplication in this batch (RPC often returns per-user, but we log per-case if the log table is per-case)
            // Wait, schema is: notification_log(case_id, notification_day).
            // It does NOT have user_id.
            // If we insert specific row, our Consumer sends to ALL users of that case.
            // But RPC returns "Due for User X".
            // If Case 1 is due, RPC returns it.
            // We should ensure we don't insert duplicate logs for the same day/case if RPC returns multiple rows (e.g. JOINs).
            // RPC 'check_and_send_notifications' logic usually filters?

            // Let's assume RPC returns unique Case-Day combos OR we rely on Consumer to fetch users.

            const key = `${item.case_id}-${item.due_day}`;
            if (seen.has(key)) continue;
            seen.add(key);

            logEntries.push({
                case_id: item.case_id,
                notification_day: item.due_day,
                sent_at: null // IMPORTANT: Mark as pending so Consumer picks it up
            });
        }

        if (logEntries.length > 0) {
            const { error: logError } = await supabase
                .from('notification_log')
                .insert(logEntries);

            if (logError) {
                console.error('Error inserting logs:', logError);
            } else {
                console.log(`Inserted ${logEntries.length} pending notifications into log.`);
            }
        }

    } catch (error) {
        console.error('Error in Due Date Checker:', error);
    }
});
