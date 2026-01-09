import express from 'express';
import { firebase } from '../config/firebase.js';

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
            notification: {
                title: '🔥 Firebase Test',
                body: 'Notification working successfully!'
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

export default router;
