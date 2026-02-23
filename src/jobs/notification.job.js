import cron from 'node-cron';
import { supabase } from '../config/supabase.js';
import { sendNotificationForCase } from '../services/notification.service.js';

cron.schedule('*/1 * * * *', async () => {
    const { data } = await supabase
        .from('notification_log')
        .select('*')
        .is('sent_at', null);

    for (const log of data || []) {
        console.log(`Processing Log ID: ${log.log_id} for Case ID: ${log.case_id} (Day ${log.notification_day})`);
        await sendNotificationForCase(log.case_id, log.notification_day);

        await supabase
            .from('notification_log')
            .update({ sent_at: new Date() })
            .eq('log_id', log.log_id);
    }
});
