const admin = require('firebase-admin');

let app;

function parseServiceAccountFromEnv() {
  // Preferred: base64-encoded JSON
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed;
  }

  // Alternative: raw JSON string in env
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed;
  }

  return null;
}

function getFirebaseAdmin() {
  if (app) return { admin, app };

  const serviceAccount = parseServiceAccountFromEnv();

  if (serviceAccount) {
    app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
    return { admin, app };
  }

  // Safe fallback for Firebase Functions/GCP runtime
  app = admin.apps.length ? admin.app() : admin.initializeApp();
  return { admin, app };
}

module.exports = { getFirebaseAdmin };
