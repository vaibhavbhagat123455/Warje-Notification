import { supabase } from '../config/supabase.js';
import { firebase } from '../config/firebase.js';

// Initialize Supabase client


export const updateFcmToken = async (req, res) => {
    try {
        const { fcm_token } = req.body;
        const { id } = req.params; // user_id

        if (!fcm_token) {
            return res.status(400).json({
                success: false,
                message: 'FCM Token is required',
            });
        }

        // Update users table in Supabase
        // Note: 'users' table is in 'public' schema
        const { data: updateData, error: updateError } = await supabase
            .from('users')
            .update({ fcm_token: fcm_token })
            .eq('user_id', id)
            .select();

        if (updateError) {
            console.error('Error updating FCM token:', updateError);
            return res.status(500).json({ error: updateError.message });
        }

        // --- NEW: Process Pending Notifications ---
        console.log(`Checking pending notifications for user ${id}...`);

        // 1. Fetch pending
        const { data: pending, error: pendingError } = await supabase
            .from('pending_notifications')
            .select('*')
            .eq('user_id', id);

        if (pendingError) {
            console.error('Error fetching pending notifications:', pendingError);
            // Don't throw, continue with FCM token update success
        }

        if (pending && pending.length > 0) {
            console.log(`Found ${pending.length} pending notifications.`);

            for (const note of pending) {
                try {
                    await firebase.messaging().send({
                        token: fcm_token, // Use the fresh token we just got
                        notification: {
                            title: note.title,
                            body: note.body
                        },
                        data: note.data || {},
                        android: { priority: 'high' }
                    });
                    console.log(`Sent pending notification ${note.id}`);
                } catch (sendErr) {
                    console.error(`Failed to send pending notif ${note.id}:`, sendErr);
                }
            }

            // 2. Clear queue
            const { error: deleteError } = await supabase
                .from('pending_notifications')
                .delete()
                .eq('user_id', id);

            if (deleteError) {
                console.error('Error clearing pending notifications queue:', deleteError);
            } else {
                console.log('Cleared pending queue.');
            }
        }
        // ------------------------------------------

        console.log(`✅ FCM Token updated for user ${id}`);

        return res.status(200).json({
            success: true,
            message: 'FCM token updated and pending notifications processed',
            data: updateData,
        });
    } catch (error) {
        console.error('Controller Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

export const logoutUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Clear FCM Token (Mark as Offline)
        const { error } = await supabase
            .from('users')
            .update({ fcm_token: null })
            .eq('user_id', id);

        if (error) {
            console.error('Error logging out user:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        console.log(`✅ User ${id} logged out (FCM Token cleared)`);
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout Controller Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
