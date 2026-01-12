import { sendNotificationForCase } from '../services/notification.service.js';

export const triggerNotification = async (req, res) => {
    const { case_id } = req.body;

    await sendNotificationForCase(case_id);

    res.json({ success: true, message: 'Notification sent' });
};

export const handleWebhook = async (req, res) => {
    try {
        const { type, table, record, old_record } = req.body;

        console.log('Webhook received:', type, table);

        if (type === 'INSERT' && table === 'notification_log') {
            const { log_id, case_id, notification_day, payload, retry_count } = record;

            console.log(`Processing Notification Log ID: ${log_id} for Case: ${case_id}`);

            await sendNotificationForCase(case_id, notification_day, payload);

            // Delete log after successful processing (Delete-on-Success)
            // We use the supabase client directly here
            const { supabase } = await import('../config/supabase.js');
            await supabase.from('notification_log').delete().eq('log_id', log_id);
            console.log(`🗑️ Deleted processed log ${log_id}`);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
