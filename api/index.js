import app from '../src/app.js';

// Vercel mounts this file at the `/api` path. When forwarding the request
// to the Express `app`, strip the leading `/api` so routes defined as
// `/api/notifications` in `src/app.js` don't become `/api/api/notifications`.
export default (req, res) => {
	try {
		if (req.url && req.url.startsWith('/api')) {
			req.url = req.url.replace(/^\/api/, '') || '/';
		}
	} catch (e) {
		// ignore and forward original url
	}

	return app(req, res);
};
