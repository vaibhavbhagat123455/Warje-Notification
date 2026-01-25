import { sendNotificationForCase } from "../services/notification.service.js";
import { supabase } from "../config/supabase.js";
import { firebase } from "../config/firebase.js";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ✅ Load Strict Stage Rules
const stagesConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../config/stages.json"), "utf8")
);

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
      let payload = log.payload || {};

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

      const title = payload.title || "Case Update";
      const body = payload.body || "You have a new update.";
      const color = payload.color || "#2196F3";
      const sound = payload.sound || "default";
      const notifType = payload.type || "GENERIC";

      // ✅ SEND FCM (DATA ONLY)
      for (const user of users) {
        if (!user.fcm_token) continue;

        try {
          await firebase.messaging().send({
            token: user.fcm_token,

            // ✅ DATA ONLY (Flutter shows styled notification)
            data: {
              title: safeString(title),
              body: safeString(body),
              case_id: safeString(caseId),
              stage_color: safeString(color),
              sound: safeString(sound),
              type: safeString(notifType),
              click_action: "FLUTTER_NOTIFICATION_CLICK",
            },

            android: {
              priority: "high",
              ttl: 60 * 60 * 1000, // 1 hour
              collapseKey: `case_${caseId}`,

              // ✅ Channel hint (helps some devices)
              notification: {
                channelId:
                  sound === "smooth_notification"
                    ? "stage_updates_channel_v2"
                    : "high_importance_channel",
              },
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
