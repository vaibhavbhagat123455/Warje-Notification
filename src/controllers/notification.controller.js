import { sendNotificationForCase } from '../services/notification.service.js';

export const triggerNotification = async (req, res) => {
    const { case_id } = req.body;

    await sendNotificationForCase(case_id);

    res.json({ success: true, message: 'Notification sent' });
};
