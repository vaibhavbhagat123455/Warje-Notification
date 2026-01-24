```javascript
import { sendNotificationForCase } from '../services/notification.service.js';
import { createClient } from '@supabase/supabase-js';
import { firebase } from '../config/firebase.js'; // Use shared config

// Initialize Supabase client (if not already initialized globally)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for backend operations
const supabase = createClient(supabaseUrl, supabaseKey);

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
            const log = record; // Renaming record to log for clarity as per snippet

            if (!log || !log.case_id) {
                console.error('Invalid webhook payload: case_id missing', req.body);
                return res.status(400).json({ error: 'Invalid payload' });
            }

            const caseId = log.case_id;
            console.log(`Processing notification log ${ log.log_id } for case ${ caseId } `);

            // Fetch case details to get user_id (assigned users)
            // Adjust column names if needed based on 'case_users' table
            const { data: caseUsers, error: usersError } = await supabase
                .from('case_users')
                .select('user_id')
                .eq('case_id', caseId);

            if (usersError) throw usersError;

            if (!caseUsers || caseUsers.length === 0) {
                console.log(`No users assigned to case ${ caseId }.`);
                // Delete log after successful processing (Delete-on-Success)
                await supabase.from('notification_log').delete().eq('log_id', log.log_id);
                console.log(`🗑️ Deleted processed log ${ log.log_id } (no users assigned)`);
                return res.status(200).json({ message: 'No users assigned' });
            }

            const userIds = caseUsers.map(u => u.user_id);

            // Fetch users to get FCM tokens
            const { data: users, error: fcmError } = await supabase
                .from('users')
                .select('user_id, fcm_token')
                .in('user_id', userIds)
                .not('fcm_token', 'is', null); // Only users with valid tokens

            if (fcmError) throw fcmError;

            const payload = log.payload || {};
            const title = payload.title || 'Case Update';
            const body = payload.body || 'You have a new update.';
            const stageColor = payload.color || '#2196F3'; // Default Blue
            const sound = payload.sound || 'default';

            const results = [];

            for (const user of users) {
                if (user.fcm_token) {
                    try {
                        const message = {
                            token: user.fcm_token,
                            notification: {
                                title: title,
                                body: body
                            },
                            data: {
                                case_id: caseId,
                                stage_color: stageColor,
                                sound: sound, // Pass sound in data for channel selection
                                ...payload
                            },
                            android: { 
                                priority: 'high',
                                notification: {
                                    sound: sound // System sound reference if supported
                                }
                            }
                        };
                        
                        await firebase.messaging().send(message);
                        results.push(`Sent to ${ user.user_id } `);
                    } catch (e) {
                        console.error(`Failed to send to ${ user.user_id }: `, e);
                        results.push(`Failed: ${ user.user_id } `);
                    }
                }
            }

            // Delete log after successful processing (Delete-on-Success)
            await supabase.from('notification_log').delete().eq('log_id', log.log_id);
            console.log(`🗑️ Deleted processed log ${ log.log_id } `);

            return res.json({ success: true, results });
        }

        // --- NEW: Handle Real-Time Stage Changes (UPDATE on cases) ---
        if (type === 'UPDATE' && table === 'cases') {
            const newStage = record.stage;
            const oldStage = old_record ? old_record.stage : null;

            if (newStage && newStage !== oldStage) {
                console.log(`🔄 Stage changed for Case ${ record.case_number }: ${ oldStage } -> ${ newStage } `);
                
                const caseId = record.case_id;
                
                // Get Assigned Users
                const { data: caseUsers } = await supabase
                    .from('case_users')
                    .select('user_id')
                    .eq('case_id', caseId);

                if (caseUsers && caseUsers.length > 0) {
                    const userIds = caseUsers.map(u => u.user_id);
                    const { data: users } = await supabase
                        .from('users')
                        .select('fcm_token')
                        .in('user_id', userIds)
                        .not('fcm_token', 'is', null);

                    if (users && users.length > 0) {
                        // Define Colors & Names
                        const stageInfo = {
                            1: { color: '#4CAF50', name: 'Investigation' },
                            2: { color: '#FF9800', name: 'Arrest & Bail' },
                            3: { color: '#2196F3', name: 'PI Supervision' },
                            4: { color: '#9C27B0', name: 'ACP Report' },
                            5: { color: '#F44336', name: 'Finalization' },
                            6: { color: '#009688', name: 'Court Verification' },
                            7: { color: '#795548', name: 'Submission to Court' },
                        };

                        const stageData = stageInfo[newStage] || { color: '#2196F3', name: 'Unknown Stage' };
                        const color = stageData.color;
                        const stageName = stageData.name;

                        // Check if it's the final stage (7) or Status is Completed to customize message further?
                        // For now, just show the Stage Name.

                        const message = {
                            notification: {
                                title: `Stage ${ newStage }: ${ stageName } `,
                                body: `Case ${ record.case_number } has been updated to ${ stageName }.`
                            },
                            data: {
                                case_id: caseId,
                                type: 'STAGE_UPDATE',
                                stage_color: color,
                                sound: 'smooth_notification'
                            },
                            android: {
                                priority: 'high',
                                notification: {
                                    sound: 'smooth_notification'
                                }
                            }
                        };

                        // Send batch or loop
                        for (const user of users) {
                            if (user.fcm_token) {
                                message.token = user.fcm_token;
                                await firebase.messaging().send(message);
                            }
                        }
                        console.log(`✅ Sent Stage Update Notification to ${ users.length } users.`);
                        return res.json({ success: true, message: 'Stage update notification sent' });
                    }
                }
            }
        }

        return res.status(200).json({ success: true, message: 'No action needed' });
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * SCHEDULER: Daily Case Check
 * Checks all active cases and inserts notification logs if they match timeline criteria.
 */
export const checkCaseStages = async (req, res) => {
    try {
        console.log('⏳ Running Daily Case Stage Check...');

        // 1. Fetch Active Cases
        const { data: cases, error } = await supabase
            .from('cases')
            .select('*')
            .in('status', ['PENDING', 'ONGOING', 'IN_PROGRESS']) // Adjust based on your enum
            .eq('is_deleted', false);

        if (error) throw error;

        const notificationsToSend = [];
        const now = new Date();

        for (const caseData of cases) {
            const createdAt = new Date(caseData.created_at);
            const diffTime = Math.abs(now - createdAt);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            const isUnder7 = caseData.under_7_years; // boolean
            let notification = null;
            
            // --- LOGIC: UNDER 7 YEARS ---
            // This section now only determines if a notification should be sent based on specific days,
            // it no longer calculates or updates the case's stage in the DB.
            if (isUnder7) {
                if ([8, 9, 10].includes(diffDays)) {
                    notification = { title: `Stage 1: Investigation(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Preliminary inquiry should be in progress.`, color: '#4CAF50', day: diffDays };
                } else if ([12, 13, 14].includes(diffDays)) {
                    notification = { title: `Stage 2: Arrest / Bail(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Check arrest / bail proceedings.`, color: '#FF9800', day: diffDays };
                } else if ([17, 18, 19].includes(diffDays)) {
                    notification = { title: `Stage 3: PI Supervision(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Investigation under Senior PI supervision.`, color: '#2196F3', day: diffDays };
                } else if ([22, 23, 24].includes(diffDays)) {
                    notification = { title: `Stage 4: ACP Report(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Submit progress report to ACP.`, color: '#9C27B0', day: diffDays };
                } else if ([26, 27].includes(diffDays)) {
                    notification = { title: `Stage 5: Finalization(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Finalize investigation & charge sheet.`, color: '#F44336', day: diffDays };
                } else if ([28, 29].includes(diffDays)) {
                    notification = { title: `Stage 6: Court Verification(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Court verification of charge sheet.`, color: '#009688', day: diffDays };
                } else if ([30].includes(diffDays)) {
                    notification = { title: `Stage 7: Submission(Day ${ diffDays })`, body: `Case ${ caseData.case_number }: Formal submission to court.`, color: '#795548', day: diffDays };
                }
            } else {
                 if ([18, 19, 20].includes(diffDays)) {
                    notification = { title: `Stage 1: Investigation(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Preliminary inquiry check.`, color: '#4CAF50', day: diffDays };
                } else if ([28, 29, 30].includes(diffDays)) {
                    notification = { title: `Stage 2: Arrest / Bail(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Arrest / Bail limit check.`, color: '#FF9800', day: diffDays };
                } else if ([33, 34, 35].includes(diffDays)) {
                    notification = { title: `Stage 3: PI Supervision(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Senior PI review due.`, color: '#2196F3', day: diffDays };
                } else if ([38, 39, 40].includes(diffDays)) {
                    notification = { title: `Stage 4: ACP Report(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Report to ACP due.`, color: '#9C27B0', day: diffDays };
                } else if ([48, 49, 50].includes(diffDays)) {
                    notification = { title: `Stage 5: Finalization(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Finalize investigation.`, color: '#F44336', day: diffDays };
                } else if ([53, 54, 55].includes(diffDays)) {
                    notification = { title: `Stage 6: Court Verification(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Court verification.`, color: '#009688', day: diffDays };
                } else if ([58, 59, 60].includes(diffDays)) {
                    notification = { title: `Stage 7: Submission(Day ${ diffDays })`, body: `Major Case ${ caseData.case_number }: Submit to court(60 day limit).`, color: '#795548', day: diffDays };
                }
            }

            if (notification) {
                notificationsToSend.push({
                    case_id: caseData.case_id,
                    notification_day: diffDays,
                    payload: {
                        title: notification.title,
                        body: notification.body,
                        color: notification.color,
                        type: 'STAGE_ALERT',
                        sound: 'smooth_notification' // Request custom sound
                    }
                });
            }
        }

        if (notificationsToSend.length > 0) {
            console.log(`Inserting ${ notificationsToSend.length } notifications...`);
            const { error: insertError } = await supabase
                .from('notification_log')
                .insert(notificationsToSend);

            if (insertError) throw insertError;
        }

        return res.json({
            success: true,
            checked: cases.length,
            notifications_generated: notificationsToSend.length
        });

    } catch (error) {
        console.error("Scheduler Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
```
