import express from 'express';
import cors from 'cors';
import notificationRoutes from './routes/notification.routes.js';
import userRoutes from './routes/user.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

// Health check — confirms service is alive on Vercel
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Warje Notification Service' }));

app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);

export default app;
