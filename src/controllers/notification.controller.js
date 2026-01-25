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
            // SMART LOOKUP: Handle both "Stage Number" (1,2..) AND "Day Number" (13, 20..)
            const category = caseData.under_7_years ? 'under_7_years' : 'over_7_years';
            const inputVal = parseInt(caseData.stage);

            console.log(`🔎 Smart Lookup: Category='${category}', Input='${inputVal}'`);

            let rule = stagesConfig[category][inputVal]; // Try direct match (Stage ID)
            let stageNum = inputVal;

            // If no direct match, assuming Input is a DAY number, search for it
            if (!rule) {
                console.log("...No direct stage match, searching by Day...");
                for (const [key, config] of Object.entries(stagesConfig[category])) {
                    if (config.days.includes(inputVal)) {
                        rule = config;
                        stageNum = key;
                        console.log(`bp Found match via Day Lookop: Day ${inputVal} -> Stage ${stageNum}`);
                        break;
                    }
                }
            }

            if (rule) {
                console.log(`✨ Matched Rule: Stage ${stageNum} - ${rule.name}`);
                payload = {
                    title: `Stage ${stageNum}: ${rule.name}`,
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
                                    // DATA-ONLY MESSAGE: Allows app to handle styling in background
                                    // notification: { title, body }, <--- REMOVED
                                    data: {
                                        title: title, // App will read this
                                        body: body,
                                        case_id: caseId.toString(),
                                        stage_color: color,
                                        sound: sound,
                                        type: payload.type || 'GENERIC'
                                    },
                                    android: {
                                        priority: 'high',
                                        // No notification block here either
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
/**
 * DEBUG ROUTE
 * Test what the backend sees for a specfic case
 */
export const debugStage = async (req, res) => {
    try {
        const { caseId } = req.params;
        const { data: caseData, error } = await supabase
            .from('cases')
            .select('*')
            .eq('case_id', caseId)
            .single();

        if (error || !caseData) return res.status(404).json({ error: 'Case not found', details: error });

        const category = caseData.under_7_years ? 'under_7_years' : 'over_7_years';
        const inputVal = parseInt(caseData.stage);

        // Smart Lookup Logic
        let rule = stagesConfig[category][inputVal];
        let matchType = "Direct Stage ID Match";
        let stageNum = inputVal;

        if (!rule) {
            for (const [key, config] of Object.entries(stagesConfig[category])) {
                if (config.days.includes(inputVal)) {
                    rule = config;
                    matchType = `Mapped from Day ${inputVal}`;
                    stageNum = key;
                    break;
                }
            }
        }

        return res.json({
            success: true,
            case_number: caseData.case_number,
            category,
            db_stage_value: inputVal,
            resolved_stage: stageNum,
            match_type: matchType,
            matched_rule: rule || "NO MATCH FOUND - CHECK STAGES.JSON"
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
