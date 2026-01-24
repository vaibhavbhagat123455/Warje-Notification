import express from 'express';
import { updateFcmToken, logoutUser } from '../controllers/user.controller.js';

const router = express.Router();

// Route: PATCH /api/users/:id/fcm-token
router.patch('/:id/fcm-token', updateFcmToken);

// Route: POST /api/users/:id/logout
router.post('/:id/logout', logoutUser);

export default router;
