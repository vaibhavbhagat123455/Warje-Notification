import admin from "firebase-admin";
import { createRequire } from "module";

const privateKey = process.env.FIREBASE_PRIVATE_KEY;

const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Defensive parsing for Vercel Environment Variables:
    privateKey: privateKey
        ? privateKey
            .replace(/\\n/g, '\n') // Fix literal \n
            .replace(/^[ "]+|[ "]+$/g, '') // Trim quotes and spaces from ends
            .trim()
        : undefined
};

if (serviceAccount.privateKey && !admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase Admin Initialized");
    } catch (error) {
        console.error("❌ Firebase Initialization Error:", error.message);
        // Do not throw here, allow the app to boot so logs can be seen
    }
}

export const firebase = admin;
