# Secure Firebase secret setup (no key files in repo)

## 0) IMPORTANT: rotate leaked key first
If a service account key was shared in chat or committed, revoke it immediately in GCP IAM -> Service Accounts -> Keys.

## 1) Preferred production approach
Use an environment variable with Base64 JSON:

- `FIREBASE_SERVICE_ACCOUNT_BASE64`

Generate it locally (do NOT commit the json file):

```bash
base64 -w 0 serviceAccountKey.json
```

Copy output and store it in your deploy provider env vars.

## 2) Alternative env var
You can use raw JSON in:

- `FIREBASE_SERVICE_ACCOUNT_JSON`

(but base64 is less error-prone due to newlines/escaping)

## 3) Runtime behavior in this repo
`server/firebaseAdmin.js` does:
1. Try `FIREBASE_SERVICE_ACCOUNT_BASE64`
2. Try `FIREBASE_SERVICE_ACCOUNT_JSON`
3. Fallback to `admin.initializeApp()` for managed Firebase/GCP runtimes

## 4) Vercel setup
Project -> Settings -> Environment Variables:
- add `FIREBASE_SERVICE_ACCOUNT_BASE64`
- redeploy

## 5) Firebase Functions setup (recommended long-term)
For Functions running inside Firebase, prefer `admin.initializeApp()` without custom key files.
