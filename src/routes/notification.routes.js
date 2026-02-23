import express from 'express';
import { firebase } from '../config/firebase.js';
import { handleWebhook, checkCaseStages, triggerNotification, debugStage } from '../controllers/notification.controller.js';

const router = express.Router();

/**
 * TEST NOTIFICATION
 * Send push to a single FCM token
 */
router.post('/test', async (req, res) => {
    try {
        const { fcm_token } = req.body;

        if (!fcm_token) {
            return res.status(400).json({ error: 'FCM token is required' });
        }

        const message = {
            token: fcm_token,
            // ✅ DATA ONLY (Awesome Notifications handles display)
            data: {
                title: '🔥 Firebase Test',
                body: 'Awesome styled notification test',
                stage_color: '#FF0000',
                sound: 'smooth_notification',
                case_id: '99',
                click_action: "FLUTTER_NOTIFICATION_CLICK"
            },
            android: {
                priority: 'high'
            }
        };

        const response = await firebase.messaging().send(message);

        res.json({
            success: true,
            firebase_response: response
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});


/**
 * SCHEDULER ROUTE
 * Called by Cron Job (e.g., GitHub Actions, Vercel Cron)
 */
router.get('/scheduler/daily-check', checkCaseStages);

router.get('/debug-stage/:caseId', debugStage);

/**
 * SUPABASE WEBHOOK
 * Triggered when a new row is inserted into notification_log
 */
router.post('/webhook', handleWebhook);

export default router;
