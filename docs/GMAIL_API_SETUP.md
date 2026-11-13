# Contact Us: Gmail API setup

Contact Us sends through Gmail API over HTTPS (port 443). The public request, response, reCAPTCHA, and rate limit are unchanged. Visitors do not authorize Gmail. Only your designated sending account grants permission once. No database migration, frontend change, or OAuth callback route is needed.

## 1. Google Cloud project and Gmail API

1. Open [Google Cloud Console](https://console.cloud.google.com/). Create/select a project for backend email. Keep its OAuth client separate from BlogHub Google Login/Auth.js.
2. Open **APIs & Services → Library**, search **Gmail API**, and enable it.
3. Open **Google Auth Platform**. Configure the app branding, support email, and developer contact information.
4. Choose an audience: **External** for a personal Gmail sender, or **Internal** only when the project and sender belong to an eligible Google Workspace organization. Workspace administrators can restrict authorization.
5. For initial External testing, add your designated sending Gmail address as a **test user**.
6. In **Data Access**, add only this scope:

   ```text
   https://www.googleapis.com/auth/gmail.send
   ```

Do not request read, modify, compose, or full-mailbox access. Google classifies `gmail.send` as sensitive. See [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 2. Create the dedicated OAuth client

1. Open **Google Auth Platform → Clients → Create client**.
2. Choose **Web application**, with a name such as `BlogHub contact email`.
3. Add this exact **Authorized redirect URI**, for the manual authorization tool only:

   ```text
   https://developers.google.com/oauthplayground
   ```

4. Save the client ID and client secret privately. These become `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`. They are not a reCAPTCHA key, Gmail password, App Password, or frontend Google-login credential.

Do not add a Gmail callback endpoint to BlogHub. The production backend refreshes an already-authorized token; it never starts interactive consent. [Google web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server)

## 3. Authorize the sender once and obtain a refresh token

1. Open Google's [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), preferably in a private browser window so you choose the correct Google account.
2. Open the settings gear. Choose **Server-side**, **Google** endpoints, **Offline** access, and a forced **Consent Screen** prompt.
3. Select **Use your own OAuth credentials**. Enter the dedicated client ID and secret from step 2. Do not use the Playground's default client: its refresh tokens are automatically revoked after 24 hours.
4. In Step 1, enter only `https://www.googleapis.com/auth/gmail.send`, then click **Authorize APIs**.
5. Sign in as the designated sender, review the requested send-only permission, and authorize it. If testing, the account must be on your test-user list. Do not ask BlogHub visitors to do this.
6. In Step 2, click **Exchange authorization code for tokens**. Save the **refresh token** privately as `GMAIL_REFRESH_TOKEN`. A short-lived access token is not a substitute.
7. If no refresh token is issued, repeat with Offline and forced consent. If needed, revoke only this dedicated application's grant in the sender's Google Account, then authorize again. Revocation invalidates the old token.
8. `GMAIL_SENDER_EMAIL` must be the actual mailbox you just authorized. Use the account's primary address for the simplest setup; arbitrary From addresses are not supported by this configuration.

Do not share screenshots of credentials/tokens or use the Playground's option to include them in shared links. Do not revoke the grant after saving the refresh token you intend to use. [Playground configuration and token notes](https://developers.google.com/oauthplayground/)

## 4. Publishing and refresh-token lifetime

External applications in **Testing** receive refresh tokens that expire after **seven days** for Gmail scopes. Before long-term production use, review the Audience/publishing status, switch to **In production** as appropriate, and obtain a fresh offline token afterward. Publishing does not mean Google has verified the app and does not make an existing token permanent.

`gmail.send` is a sensitive scope. Public OAuth applications generally need Google's sensitive-scope verification unless an exception applies. For a sender-only integration, review Google's personal-use/internal-use exceptions rather than assuming every contact-form visitor is an OAuth user. Follow the Console's requirements; do not tell visitors to bypass an unverified-app warning. [Verification requirements and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

Tokens can also stop working after grant revocation, password changes involving Gmail scopes, inactivity, token limits, or organization policies. There is no guaranteed permanent refresh token. If the grant is invalid, reauthorize the designated sender and replace the stored token. [Google refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration)

## 5. Local environment and Render

Set these five private backend variables in your local `.env` and **Render → existing web service → Environment**:

```env
GMAIL_CLIENT_ID=your-dedicated-oauth-client-id
GMAIL_CLIENT_SECRET=your-private-client-secret
GMAIL_REFRESH_TOKEN=your-private-offline-refresh-token
GMAIL_SENDER_EMAIL=your-authorized-sender@gmail.com
CONTACT_SUPPORT_EMAIL=your-support-inbox@example.com
```

`CONTACT_SUPPORT_EMAIL` may be another inbox; it does not need to grant sending permission. `GMAIL_SENDER_EMAIL` is the sender; the visitor's validated name/address is Reply-To.

- Required Gmail settings are validated during web startup. Configure them **before deploying this commit**; otherwise startup intentionally fails with `Contact Gmail API is not configured`. This validates presence/address formatting, not whether Google will accept the grant. No email or token refresh happens just by starting the service.
- Keep your current `RECAPTCHA_SECRET_KEY` and `RECAPTCHA_ALLOWED_HOSTNAMES`. Keep CORS settings, JWT, push flags, database settings, web build/start commands, and Node 22.
- Keep Gmail secrets server-only. No `NEXT_PUBLIC_` variables or mobile settings are needed. Gmail credentials do not belong on the separate push worker.
- Remove the obsolete `CONTACT_FROM_EMAIL`. Keep `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and Nodemailer: password reset still uses its existing SMTP implementation. Its SMTP port restrictions on Render Free are unchanged.
- Commit source, documentation, `package.json`, and `package-lock.json`; never commit `.env` or downloaded OAuth credentials. Deploy the updated web service after setting the variables. No migration or seed command is needed.

## 6. Test after configuration

1. Locally, run `npm run start:dev`, or deploy the configured web service to Render.
2. Use the existing frontend contact form. Solve a fresh reCAPTCHA challenge with the matching site key on an allowed hostname and submit once. The frontend request remains exactly the same.
3. Expect `200` and `{"message":"Your message has been sent successfully."}` only after Gmail acknowledges sending. Check the support inbox/spam folder and the sender's Sent folder. Verify the sender and Reply-To; reply to the visitor manually if needed.
4. Gmail API acceptance is not proof of inbox placement. If the HTTP response is lost or times out, check Sent before retrying; a send may have succeeded. Obtain a new CAPTCHA before any new manual attempt. Do not automatically retry contact submissions.
5. Invalid/reused CAPTCHA remains `400`; excess attempts remain `429`. Gmail OAuth/quota/network/send errors return the same safe `503` as before, with a fixed sanitized log message.

No real email was sent while implementing or running automated tests. Manual delivery testing must use a recipient you are authorized to contact.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Web startup configuration error | All five required variables, valid single sender/support addresses, correct Render service |
| Google authorization denied | Correct account/test-user list, audience, Workspace admin policy, exact redirect URI |
| Invalid/revoked refresh grant | Matching client ID/secret/token, token lifetime and publishing status; reauthorize sender |
| Permission/API error | Gmail API enabled in the client project; token authorized with only `gmail.send` |
| Quota/rate error | Google Cloud Gmail quota and account sending limits; do not retry automatically |
| Timeout/unavailable | Outbound Google HTTPS connectivity, provider availability; check Sent before another attempt |
| Wrong sender | Sender address matches the Google account that granted the refresh token |

Provider error objects, credentials, raw MIME, tokens, and full visitor messages must not be printed in logs or pasted into tickets. The application intentionally exposes only safe delivery errors. [Gmail API sending contract](https://developers.google.com/workspace/gmail/api/guides/sending)
