# Firebase migration (project: galaxian-dae59)

## Target architecture
- Firebase Hosting -> frontend (dist)
- Cloud Functions (europe-west1) -> API under /api/*
- Firestore -> users/characters/chat history

## One-time setup

```bash
npm i -g firebase-tools
firebase login
cd /root/.openclaw/workspace/projects/galaxia-sw
firebase use galaxian-dae59
npm run build
cd functions && npm install && cd ..
```

## Enable products in Firebase Console
1. Authentication -> Sign-in method -> Email/Password (optional for future migration)
2. Firestore Database -> create database (production mode)

## Deploy

```bash
cd /root/.openclaw/workspace/projects/galaxia-sw
npm run build
firebase deploy --only hosting,functions
```

## API compatibility
Frontend keeps using `/api/*`.
Hosting rewrite sends `/api/**` to Function `api`.

## Security notes
- Do not store service account JSON in repo.
- Revoke any previously exposed keys immediately.
- For Functions on Firebase, Admin SDK uses `admin.initializeApp()` (no key file required).
