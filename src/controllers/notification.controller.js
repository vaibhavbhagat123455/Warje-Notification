import { sendNotificationForCase } from '../services/notification.service.js';
import { supabase } from '../config/supabase.js'; // Use shared config
import { firebase } from '../config/firebase.js';

// No local supabase init here anymore

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
            const log = record;

            if (!log || !log.case_id) {
                console.error('Invalid webhook payload: case_id missing', req.body);
                return res.status(400).json({ error: 'Invalid payload' });
            }

            const caseId = log.case_id;
            console.log(`Processing notification log ${log.log_id} for case ${caseId}`);

            // Fetch case details to get user_id (assigned users)
            const { data: caseUsers, error: usersError } = await supabase
                .from('case_users')
                .select('user_id')
                .eq('case_id', caseId);

            if (usersError) throw usersError;

            if (!caseUsers || caseUsers.length === 0) {
                console.log(`No users assigned to case ${caseId}.`);
                await supabase.from('notification_log').delete().eq('log_id', log.log_id);
                console.log(`🗑️ Deleted processed log ${log.log_id} (no users assigned)`);
                return res.status(200).json({ message: 'No users assigned' });
            }

            const userIds = caseUsers.map(u => u.user_id);

            // Fetch users to get FCM tokens
            const { data: users, error: fcmError } = await supabase
                .from('users')
                .select('user_id, fcm_token')
                .in('user_id', userIds)
                .not('fcm_token', 'is', null);

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
                                sound: sound,
                                ...payload
                            },
                            android: {
                                priority: 'high',
                                notification: {
                                    sound: sound
                                }
                            }
                        };

                        await firebase.messaging().send(message);
                        results.push(`Sent to ${user.user_id}`);
                    } catch (e) {
                        console.error(`Failed to send to ${user.user_id}:`, e);
                        results.push(`Failed: ${user.user_id}`);
                    }
                }
            }

            // Delete log after successful processing (Delete-on-Success)
            await supabase.from('notification_log').delete().eq('log_id', log.log_id);
            console.log(`🗑️ Deleted processed log ${log.log_id}`);

            return res.json({ success: true, results });
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
            .in('status', ['PENDING', 'ONGOING', 'IN_PROGRESS'])
            .eq('is_deleted', false);

        if (error) throw error;

        const notificationsToSend = [];
        const now = new Date();

        for (const caseData of cases) {
            const createdAt = new Date(caseData.created_at);
            const diffTime = Math.abs(now - createdAt);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            const isUnder7 = caseData.under_7_years;
            let notification = null;

            // --- LOGIC: UNDER 7 YEARS ---
            if (isUnder7) {
                if ([8, 9, 10].includes(diffDays)) {
                    notification = { title: `Stage 1: Investigation (Day ${diffDays})`, body: `Case ${caseData.case_number}: Preliminary inquiry should be in progress.`, color: '#4CAF50', day: diffDays };
                } else if ([12, 13, 14].includes(diffDays)) {
                    notification = { title: `Stage 2: Arrest/Bail (Day ${diffDays})`, body: `Case ${caseData.case_number}: Check arrest/bail proceedings.`, color: '#FF9800', day: diffDays };
                } else if ([17, 18, 19].includes(diffDays)) {
                    notification = { title: `Stage 3: PI Supervision (Day ${diffDays})`, body: `Case ${caseData.case_number}: Investigation under Senior PI supervision.`, color: '#2196F3', day: diffDays };
                } else if ([22, 23, 24].includes(diffDays)) {
                    notification = { title: `Stage 4: ACP Report (Day ${diffDays})`, body: `Case ${caseData.case_number}: Submit progress report to ACP.`, color: '#9C27B0', day: diffDays };
                } else if ([26, 27].includes(diffDays)) {
                    notification = { title: `Stage 5: Finalization (Day ${diffDays})`, body: `Case ${caseData.case_number}: Finalize investigation & charge sheet.`, color: '#F44336', day: diffDays };
                } else if ([28, 29].includes(diffDays)) {
                    notification = { title: `Stage 6: Court Verification (Day ${diffDays})`, body: `Case ${caseData.case_number}: Court verification of charge sheet.`, color: '#009688', day: diffDays };
                } else if ([30].includes(diffDays)) {
                    notification = { title: `Stage 7: Submission (Day ${diffDays})`, body: `Case ${caseData.case_number}: Formal submission to court.`, color: '#795548', day: diffDays };
                }
            } else {
                if ([18, 19, 20].includes(diffDays)) {
                    notification = { title: `Stage 1: Investigation (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Preliminary inquiry check.`, color: '#4CAF50', day: diffDays };
                } else if ([28, 29, 30].includes(diffDays)) {
                    notification = { title: `Stage 2: Arrest/Bail (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Arrest/Bail limit check.`, color: '#FF9800', day: diffDays };
                } else if ([33, 34, 35].includes(diffDays)) {
                    notification = { title: `Stage 3: PI Supervision (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Senior PI review due.`, color: '#2196F3', day: diffDays };
                } else if ([38, 39, 40].includes(diffDays)) {
                    notification = { title: `Stage 4: ACP Report (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Report to ACP due.`, color: '#9C27B0', day: diffDays };
                } else if ([48, 49, 50].includes(diffDays)) {
                    notification = { title: `Stage 5: Finalization (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Finalize investigation.`, color: '#F44336', day: diffDays };
                } else if ([53, 54, 55].includes(diffDays)) {
                    notification = { title: `Stage 6: Court Verification (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Court verification.`, color: '#009688', day: diffDays };
                } else if ([58, 59, 60].includes(diffDays)) {
                    notification = { title: `Stage 7: Submission (Day ${diffDays})`, body: `Major Case ${caseData.case_number}: Submit to court (60 day limit).`, color: '#795548', day: diffDays };
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
            console.log(`Inserting ${notificationsToSend.length} notifications...`);
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
