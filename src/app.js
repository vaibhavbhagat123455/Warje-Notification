import express from 'express';
import cors from 'cors';
import notificationRoutes from './routes/notification.routes.js';
import userRoutes from './routes/user.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);

export default app;
