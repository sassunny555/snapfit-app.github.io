# SnapFit reusable promotion system

The public page is available at `/promo/` and the protected inventory console is at `/promo/admin.html`.

## Architecture

- The existing site remains plain HTML, CSS, and JavaScript on GitHub Pages.
- Firebase callable Cloud Functions perform every inventory operation.
- Firestore stores campaigns, available/claimed codes, claim timestamps, and hashed abuse-prevention records.
- Firestore security rules deny every direct browser read and write. Cloud Functions use the Admin SDK.
- Claim assignment runs in a Firestore transaction, so two visitors cannot receive the same code.
- One claim is allowed per normalized email and browser identifier. A network can claim up to three codes.
- Emails, browser identifiers, and IP addresses are HMAC-hashed before storage; raw values are not retained.

## One-time Firebase setup

1. Use the Firebase Blaze plan. Cloud Functions deployment and outbound production execution require billing.
2. In Firebase Authentication, enable the **Google** sign-in provider for the admin console.
3. Add `snapfit-app.online` to Authentication → Settings → Authorized domains.
4. Ensure a Firestore database exists in production mode. `asia-southeast1` is the preferred region for this deployment.
5. Copy `functions/.env.example` to `functions/.env.snapfit-web-820e0` and set `ADMIN_EMAILS` to a comma-separated admin allowlist. The project currently has a local deployment file configured for `itsneodesign@gmail.com`; environment files are intentionally excluded from Git.
6. Set the server hashing secret if it has not already been set:

   ```sh
   openssl rand -base64 48 | firebase functions:secrets:set CLAIM_HASH_SECRET --data-file=- --project snapfit-web-820e0
   ```

7. Deploy only the backend (the website can continue deploying through GitHub Pages):

   ```sh
   firebase deploy --only functions,firestore --project snapfit-web-820e0
   ```

## Launching a promotion

1. Open `/promo/admin.html` and sign in with an allowlisted Google account.
2. Save the campaign once with claims disabled.
3. Paste or upload codes into the import area. Codes are normalized to uppercase and duplicates are ignored.
4. Confirm the available inventory count, then enable **Accept new claims**.
5. Share `/promo/`.

Claimed codes cannot be deleted or returned to inventory from the admin page. This is intentional to preserve the one-use guarantee and audit trail.

## Reusing for a future promotion

Change `PROMO_CAMPAIGN_ID` in `promo/firebase-config.js` to a new lowercase ID such as `new-year-2027`, deploy the static site, then create and load that campaign from the admin page. Previous campaigns and claims remain isolated by campaign ID.

## Recommended hardening after launch

- Enable Firebase App Check for the web app, then set `enforceAppCheck: true` on callable functions after verifying valid traffic.
- Configure Firebase budget alerts and Cloud Functions usage alerts.
- Review Cloud Functions logs for unusual claim volume.
- Keep the admin allowlist minimal and remove access immediately when no longer needed.
