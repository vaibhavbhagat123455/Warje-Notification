import { sendNotificationForCase } from "../services/notification.service.js";
import { supabase } from "../config/supabase.js";
import { firebase } from "../config/firebase.js";

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Load Strict Stage Rules
const stagesConfig = require("../config/stages.json");

// ✅ Helper: Safe stringify
const safeString = (v) => (v === null || v === undefined ? "" : String(v));

export const triggerNotification = async (req, res) => {
    try {
        const { case_id } = req.body;

        await sendNotificationForCase(case_id);

        return res.json({ success: true, message: "Notification sent" });
    } catch (e) {
        console.error("triggerNotification error:", e);
        return res.status(500).json({ success: false, error: e.message });
    }
};

export const handleWebhook = async (req, res) => {
    try {
        const { type, table, record } = req.body;

        console.log(`🔔 Webhook: ${type} on ${table}`);

        if (type === "INSERT" && table === "notification_log") {
            const log = record;
            if (!log || !log.case_id) {
                return res.status(400).json({ error: "Invalid payload" });
            }

            const caseId = log.case_id;
            // ✅ Fetch case details
            const { data: caseData, error: caseError } = await supabase
                .from("cases")
                .select("case_number, under_7_years, stage")
                .eq("case_id", caseId)
                .single();

            if (caseError || !caseData) {
                console.error("❌ Failed to fetch case data:", caseError);

                await supabase.from("notification_log").delete().eq("log_id", log.log_id);
                return res.json({ success: false, message: "Case not found" });
            }

            // ✅ Smart Lookup (stageId or day)
            const category = caseData.under_7_years ? "under_7_years" : "over_7_years";
            const inputVal = parseInt(caseData.stage);

            console.log(`🔎 Category='${category}', Input='${inputVal}'`);

            let rule = stagesConfig?.[category]?.[inputVal];
            let stageNum = inputVal;
            let matchType = "Direct Stage ID Match";

            if (!rule) {
                for (const [key, config] of Object.entries(stagesConfig?.[category] || {})) {
                    if (Array.isArray(config.days) && config.days.includes(inputVal)) {
                        rule = config;
                        stageNum = key;
                        matchType = `Mapped from Day ${inputVal}`;
                        break;
                    }
                }
            }

            let payload = {};
            if (rule) {
                payload = {
                    title: `Stage ${stageNum}: ${rule.name}`,
                    body: `Case ${caseData.case_number}: ${rule.message}`,
                    color: rule.color || "#2196F3",
                    sound: "smooth_notification",
                    type: "STAGE_UPDATE",
                    match_type: matchType,
                };
            } else {
                console.warn(`⚠️ No rule found for ${category} / ${inputVal}`);
                // Fallback
                payload = {
                    title: "Case Update",
                    body: `Case ${caseData.case_number} has been updated.`,
                    color: "#2196F3",
                    sound: "default"
                };
            }

            // ✅ Fetch Assigned Users
            const { data: caseUsers } = await supabase
                .from("case_users")
                .select("user_id")
                .eq("case_id", caseId);

            if (!caseUsers || caseUsers.length === 0) {
                await supabase.from("notification_log").delete().eq("log_id", log.log_id);
                return res.json({ success: true, message: "No assigned users" });
            }

            const userIds = caseUsers.map((u) => u.user_id);

            const { data: users } = await supabase
                .from("users")
                .select("user_id, fcm_token")
                .in("user_id", userIds)
                .not("fcm_token", "is", null);

            if (!users || users.length === 0) {
                await supabase.from("notification_log").delete().eq("log_id", log.log_id);
                return res.json({ success: true, message: "No fcm tokens" });
            }

            const title = payload.title;
            const body = payload.body;
            const color = payload.color;
            const sound = payload.sound;
            const notifType = payload.type || "GENERIC";

            // ✅ SEND FCM (DATA ONLY)
            for (const user of users) {
                if (!user.fcm_token) continue;

                try {
                    await firebase.messaging().send({
                        token: user.fcm_token,

                        // ✅ DATA ONLY (Awesome Notifications handles display)
                        data: {
                            title: safeString(title),
                            body: safeString(body),
                            case_id: safeString(caseId),
                            stage_color: safeString(color),
                            sound: safeString(sound),
                            type: safeString(notifType),
                            click_action: "FLUTTER_NOTIFICATION_CLICK"
                        },

                        android: {
                            priority: "high",
                            ttl: 60 * 60 * 1000,
                            // No 'notification' block - Silent delivery to app
                        },
                    });

                    console.log(`✅ Sent FCM to user ${user.user_id}`);
                } catch (e) {
                    console.error(`❌ Failed to send to user ${user.user_id}:`, e.message);
                }
            }

            console.log(`✅ FCM Sent: ${title}`);

            // ✅ Delete log after processing
            await supabase.from("notification_log").delete().eq("log_id", log.log_id);

            return res.json({ success: true });
        }

        return res.status(200).json({ success: true, message: "No action needed" });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * SCHEDULER: Daily Case Check
 */
export const checkCaseStages = async (req, res) => {
    try {
        console.log('⏳ Running Daily Case Stage Check (Strict Mode)...');

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

        let rule = stagesConfig?.[category]?.[inputVal];
        let matchType = "Direct Stage ID Match";
        let stageNum = inputVal;

        if (!rule) {
            for (const [key, config] of Object.entries(stagesConfig?.[category] || {})) {
                if (Array.isArray(config.days) && config.days.includes(inputVal)) {
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
