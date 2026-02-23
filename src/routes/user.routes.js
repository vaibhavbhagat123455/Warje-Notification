import express from 'express';
import { updateFcmToken, logoutUser, getUser } from '../controllers/user.controller.js';

const router = express.Router();

// Route: PATCH /api/users/:id/fcm-token
router.patch('/:id/fcm-token', updateFcmToken);

// Route: POST /api/users/:id/logout
// Route: POST /api/users/:id/logout
router.post('/:id/logout', logoutUser);

// Route: GET /api/users/:id (For Verification)
router.get('/:id', getUser);

export default router;
