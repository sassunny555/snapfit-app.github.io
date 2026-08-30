# SnapFit reusable promotion system

The public page is available at `/promo/` and the protected inventory console is at `/promo/admin.html`.

## Architecture

- The existing site remains plain HTML, CSS, and JavaScript, hosted on Vercel.
- A same-origin Vercel Function at `/api/promo` performs every inventory operation.
- Firestore stores campaigns, available/claimed codes, claim timestamps, and hashed abuse-prevention records.
- Firestore security rules deny every direct browser read and write. The Vercel Function uses the Admin SDK.
- Claim assignment runs in a Firestore transaction, so two visitors cannot receive the same code.
- Public claims require only a display name. One claim is allowed per browser identifier, and a network can claim up to three codes.
- Browser identifiers and IP addresses are HMAC-hashed before storage; raw identifiers are not retained. The submitted display name is stored with the claim for administration.

## One-time Firebase and Vercel setup

1. In Firebase Authentication, enable the **Google** sign-in provider for the admin console.
2. Add `snapfit-app.online` and `www.snapfit-app.online` to Authentication → Settings → Authorized domains.
3. Ensure a Firestore database exists in production mode.
4. In Firebase Project settings → Service accounts, generate a private key for the Admin SDK. Do not commit or paste this JSON into frontend code.
5. In Vercel Project settings → Environment Variables, add these values to Production, Preview, and Development:

   - `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete service-account JSON object
   - `CLAIM_HASH_SECRET`: a random value containing at least 32 characters
   - `ADMIN_EMAILS`: comma-separated verified Google accounts allowed to administer promotions

6. Redeploy the Vercel project after saving environment variables.
7. Deploy the Firestore indexes and deny-all client rules once:

   ```sh
   firebase deploy --only firestore --project snapfit-web-820e0
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

- Configure Firebase and Vercel usage alerts.
- Review Vercel Function logs for unusual claim volume.
- Keep the admin allowlist minimal and remove access immediately when no longer needed.
