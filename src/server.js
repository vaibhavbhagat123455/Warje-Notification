// MUST be first line
import 'dotenv/config';

import app from './app.js';
import './jobs/notification.job.js';
import './jobs/checker.job.js';
import { initRealtimeListener } from './services/realtime.service.js';

// Initialize Realtime Listener
initRealtimeListener();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
