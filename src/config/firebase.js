import admin from "firebase-admin";
import { createRequire } from "module";

const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Handle private key newlines for Vercel/Env compatibility
    privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

export const firebase = admin;
