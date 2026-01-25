import { sendNotificationForCase } from '../services/notification.service.js';
import { supabase } from '../config/supabase.js'; // Use shared config
import { firebase } from '../config/firebase.js';

// No local supabase init here anymore

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load Strict Stage Rules
const stagesConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/stages.json'), 'utf8'));

export const triggerNotification = async (req, res) => {
    const { case_id } = req.body;

    await sendNotificationForCase(case_id);

    res.json({ success: true, message: 'Notification sent' });
};

export const handleWebhook = async (req, res) => {
    try {
        const { type, table, record } = req.body;

        console.log(`🔔 Webhook: ${type} on ${table}`);

        if (type === 'INSERT' && table === 'notification_log') {
            const log = record;
            if (!log || !log.case_id) return res.status(400).json({ error: 'Invalid payload' });

            const caseId = log.case_id;
            let payload = log.payload || {};

            // FETCH CASE DETAILS TO DETERMINE CATEGORY (Under/Over 7 Years)
            const { data: caseData, error: caseError } = await supabase
                .from('cases')
                .select('case_number, under_7_years, stage')
                .eq('case_id', caseId)
                .single();

            if (caseError || !caseData) {
                console.error("Failed to fetch case data for webhook:", caseError);
                await supabase.from('notification_log').delete().eq('log_id', log.log_id);
                return res.json({ success: false, message: 'Case not found' });
            }

            // --- SINGLE SOURCE OF TRUTH LOGIC ---
            // ALWAYS try to enrich based on the current stage in the DB.
            const category = caseData.under_7_years ? 'under_7_years' : 'over_7_years';
            const currentStage = String(caseData.stage); // Ensure string for JSON lookup

            console.log(`🔎 Lookup: Category='${category}', Stage='${currentStage}'`);

            const rule = stagesConfig[category] ? stagesConfig[category][currentStage] : null;

            if (rule) {
                console.log(`✨ Matched Rule: ${rule.name}`);
                payload = {
                    title: `Stage ${currentStage}: ${rule.name}`,
                    body: `Case ${caseData.case_number}: ${rule.message}`,
                    color: rule.color,
                    sound: 'smooth_notification',
                    type: 'STAGE_UPDATE'
                };
            } else {
                console.warn(`⚠️ No matching rule found in stages.json for ${category} / ${currentStage}`);
            }

            // Fetch Assigned Users
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
                    const title = payload.title || 'Case Update';
                    const body = payload.body || 'You have a new update.';
                    const color = payload.color || '#2196F3';
                    const sound = payload.sound || 'default';

                    for (const user of users) {
                        if (user.fcm_token) {
                            try {
                                await firebase.messaging().send({
                                    token: user.fcm_token,
                                    notification: { title, body },
                                    data: {
                                        case_id: caseId.toString(),
                                        stage_color: color,
                                        sound: sound,
                                        type: payload.type || 'GENERIC'
                                    },
                                    android: {
                                        priority: 'high',
                                        notification: {
                                            sound: sound,
                                            // Ensure channel matches sound for customized playback
                                            channelId: sound === 'smooth_notification' ? 'stage_updates_channel_v2' : 'high_importance_channel',
                                            color: color // Request icon accent color
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error(`Failed to send to user ${user.user_id}:`, e.message);
                            }
                        }
                    }
                    console.log(`✅ FCM Sent: ${title}`);
                } else {
                    console.log(`No FCM tokens found for users assigned to case ${caseId}.`);
                }
            } else {
                console.log(`No users assigned to case ${caseId}.`);
            }

            // Delete log after processing
            await supabase.from('notification_log').delete().eq('log_id', log.log_id);
            return res.json({ success: true });
        }

        return res.status(200).json({ success: true, message: 'No action needed' });
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * SCHEDULER: Daily Case Check
 */
export const checkCaseStages = async (req, res) => {
    try {
        console.log('⏳ Running Daily Case Stage Check (JSON Strict Mode)...');

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

            const category = caseData.under_7_years ? 'under_7_years' : 'over_7_years';
            const rules = stagesConfig[category];

            // Find matching stage rule for this day
            let matchedRule = null;
            let matchedStageNum = null;

            for (const [stageNum, config] of Object.entries(rules)) {
                if (config.days.includes(diffDays)) {
                    matchedRule = config;
                    matchedStageNum = stageNum;
                    break;
                }
            }

            if (matchedRule) {
                notificationsToSend.push({
                    case_id: caseData.case_id,
                    notification_day: diffDays,
                    payload: {
                        title: `🔔 Stage ${matchedStageNum}: ${matchedRule.name}`,
                        body: `Case ${caseData.case_number}: ${matchedRule.message}`,
                        color: matchedRule.color,
                        type: 'STAGE_ALERT',
                        sound: 'smooth_notification'
                    }
                });
            }
        }

        if (notificationsToSend.length > 0) {
            const { error: insertError } = await supabase
                .from('notification_log')
                .insert(notificationsToSend);
            if (insertError) throw insertError;
            console.log(`🚀 Inserted ${notificationsToSend.length} professional notifications.`);
        } else {
            console.log('No stage notifications generated today.');
        }

        return res.json({
            success: true,
            checked: cases.length,
            generated: notificationsToSend.length
        });

    } catch (error) {
        console.error("Scheduler Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
