import express from 'express';
import { updateFcmToken } from '../controllers/user.controller.js';

const router = express.Router();

// Route: PATCH /api/users/:id/fcm-token
router.patch('/:id/fcm-token', updateFcmToken);

export default router;
