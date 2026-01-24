import admin from "firebase-admin";
import { createRequire } from "module";

const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Robustly handle private key: 
    // 1. Replace literal "\n" with actual newlines
    // 2. Remove any surrounding double quotes
    // 3. Trim extra whitespace
    privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '').trim()
        : undefined
};

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

export const firebase = admin;
