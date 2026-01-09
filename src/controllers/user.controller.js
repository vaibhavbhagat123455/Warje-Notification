import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use Service Role Key for admin rights

const supabase = createClient(supabaseUrl, supabaseKey);

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
        const { data, error } = await supabase
            .from('users')
            .update({ fcm_token: fcm_token })
            .eq('user_id', id)
            .select();

        if (error) {
            console.error('Error updating FCM token in Supabase:', error);
            throw error;
        }

        console.log(`✅ FCM Token updated for user ${id}`);

        return res.status(200).json({
            success: true,
            message: 'FCM Token updated successfully',
            data: data,
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
