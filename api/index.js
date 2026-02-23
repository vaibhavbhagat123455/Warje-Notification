// ✅ CRITICAL: Load env vars FIRST — before Firebase/Supabase initialize
import 'dotenv/config';

import app from '../src/app.js';

// ✅ Forward the request directly to Express.
// vercel.json rewrites all traffic here with the ORIGINAL URL intact,
// so routes like /api/notifications/test match app.use('/api/notifications', ...) correctly.
export default (req, res) => {
	return app(req, res);
};
