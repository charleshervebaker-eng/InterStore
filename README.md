# InterStore

A minimal, modern place for small developers to share downloadable APKs.

## Structure

```
interstore/
├── server.js            # Express API + uploads
├── package.json
├── public/
│   ├── index.html       # Markup
│   ├── css/style.css    # Styles
│   └── js/app.js        # Front-end logic
├── uploads/             # Created at runtime (APKs + icons)
└── data/apps.json       # Created at runtime (app listings)
```

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

Uploads are password-protected. Set `UPLOAD_PASSWORD` before starting, or uploads stay disabled:

```bash
# macOS / Linux
UPLOAD_PASSWORD="your-password" npm start

# Windows (PowerShell)
$env:UPLOAD_PASSWORD="your-password"; npm start
```

On Render, add it under your service's **Environment** tab.

Other env vars: `PORT` (default 3000), `MAX_APK_MB` (default 200).

## About your AAB file

Google Play uses `.aab` (Android App Bundle), but **an AAB cannot be installed directly on a phone**.
InterStore accepts `.apk` only. Convert your AAB to a universal APK with
[bundletool](https://developer.android.com/tools/bundletool):

```bash
java -jar bundletool.jar build-apks \
  --bundle=app.aab \
  --output=app.apks \
  --mode=universal \
  --ks=your.keystore --ks-alias=youralias

unzip app.apks universal.apk
```

Then upload `universal.apk`. Without the `--ks` flags, bundletool signs with a debug key,
which is fine for testing but use your own keystore for real releases.

## Before going public

- Uploads are open to anyone. Add accounts/login and a moderation step before launching,
  since APKs can carry malware.
- Put it behind HTTPS (Nginx/Caddy, or a host like Render/Railway/Fly.io).
- The JSON file store is fine for a start; move to SQLite/Postgres as you grow.
- Serve `uploads/` from persistent storage (many hosts wipe local disks on redeploy).
