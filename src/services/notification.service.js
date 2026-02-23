import { firebase } from '../config/firebase.js';
import { supabase } from '../config/supabase.js';

export const sendNotificationForCase = async (caseId, notificationDay, payload = null) => {
    // 1. Fetch Case Details + Users
    // We need case_number and title for the message
    const { data: caseData, error: caseError } = await supabase
        .from('cases')
        .select('case_number, title')
        .eq('case_id', caseId)
        .single();

    if (caseError || !caseData) {
        console.error(`Failed to fetch case details for CaseID: ${caseId}`, caseError);
        return;
    }

    const { data: users, error: usersError } = await supabase
        .from('case_users')
        .select('user_id, users(fcm_token)')
        .eq('case_id', caseId);

    if (usersError) {
        console.error(`Error fetching users for Case ${caseId}:`, usersError);
        return;
    }

    if (!users || users.length === 0) {
        console.warn(`⚠️ No users assigned to Case ${caseData.case_number}. No notifications sent.`);
        return;
    }

    console.log(`Found ${users.length} assigned users for Case ${caseData.case_number}.`);

    // 2. Determine Message Content
    let messageBody = '';
    let messageTitle = `Case Alert: ${caseData.case_number}`;

    if (notificationDay >= 10 && notificationDay <= 14) {
        messageBody = `Action required: Case ${caseData.case_number} (${caseData.title}) is in its initial review period (Days 10-14).`;
    } else if (notificationDay >= 15 && notificationDay <= 19) {
        messageBody = `URGENT FOLLOW-UP: Case ${caseData.case_number} has reached the mid-term review stage (Days 15-19).`;
    } else if (notificationDay >= 20 && notificationDay <= 24) {
        messageBody = `CRITICAL ACTION WINDOW: Case ${caseData.case_number} is in the 20-24 day phase. Finalize actions.`;
    } else if (notificationDay >= 25 && notificationDay <= 27) {
        messageBody = `FINAL WARNING: Case ${caseData.case_number} is approaching the 28-day expiration threshold.`;
        messageTitle = `FINAL WARNING: ${caseData.case_number}`;
    } else if (notificationDay === -1 || notificationDay === null) {
        // Generic Update Event
        if (payload && payload.status) {
            messageBody = `Update: Case ${caseData.case_number} status is now '${payload.status}'.`;
            messageTitle = `Case Status: ${payload.status}`;
        } else if (payload && payload.priority) {
            messageBody = `Update: Case ${caseData.case_number} priority set to '${payload.priority}'.`;
        } else {
            messageBody = `Update: There has been activity on Case ${caseData.case_number}.`;
            messageTitle = `Case Update: ${caseData.case_number}`;
        }
    } else if (notificationDay === -2) {
        // New Assignment Event
        messageBody = `You have been assigned to a new Case: ${caseData.case_number} (${caseData.title}).`;
        messageTitle = `New Case Assigned`;
    } else {
        messageBody = `Case ${caseData.case_number} is due for a Day ${notificationDay} check.`;
    }

    // 3. Send Notification to all assigned users
    // 3. Send Notification or Queue for Offline Users
    for (const u of users) {
        if (!u.users) continue;

        const { fcm_token } = u.users; // No is_logged_in needed
        const userId = u.user_id;

        // CHECK OFFLINE STATUS (If Token is Null/Empty -> User is Offline)
        if (!fcm_token) {
            console.log(`User ${userId} has NO FCM Token (Offline). Queuing notification.`);

            // Insert into pending_notifications
            try {
                await supabase.from('pending_notifications').insert({
                    user_id: userId,
                    title: messageTitle,
                    body: messageBody,
                    data: {
                        case_id: caseId,
                        click_action: "FLUTTER_NOTIFICATION_CLICK"
                    }
                });
                console.log(`✅ Queued pending notification for user ${userId}`);
            } catch (queueError) {
                console.error(`Failed to queue notification for user ${userId}:`, queueError);
            }
            continue; // Skip sending
        }

        try {
            await firebase.messaging().send({
                token: fcm_token,
                // ✅ DATA ONLY (Awesome Notifications handles display)
                data: {
                    title: messageTitle,
                    body: messageBody,
                    case_id: String(caseId),
                    click_action: "FLUTTER_NOTIFICATION_CLICK"
                },
                android: {
                    priority: 'high',
                    ttl: 60 * 60 * 1000 // 1 hour
                }
            });
            console.log(`Sent notification for Case ${caseData.case_number} (Day ${notificationDay}) to Token ending in ...${fcm_token.slice(-4)}`);
        } catch (e) {
            console.error(`Failed to send FCM to user ${userId}:`, e.message);
        }
    }
};
