# Contact Us API — email only + Google reCAPTCHA v2 Checkbox

`POST /api/v1/contact` is public for guests and signed-in visitors. It does not authenticate or associate submissions with user accounts. An Authorization header is optional and ignored. No database entity, migration, saved submission, dashboard, or ticket was added.

## Request and response

```http
POST /api/v1/contact
Content-Type: application/json
```

```json
{
  "name": "Example User",
  "email": "user@example.com",
  "subject": "Technical Issue",
  "message": "I cannot publish my blog post.",
  "captchaToken": "fresh-token-from-the-v2-checkbox-widget"
}
```

All five fields are required. Unknown fields are rejected. Strings are trimmed. Limits: name 2–100 characters, valid email up to 254, subject 3–150, message 10–2,000, CAPTCHA token 1–8,192. Header fields reject control characters and line breaks; messages may contain plain-text line breaks but not NUL bytes.

Success: **200** after Gmail API acknowledges the send request:

```json
{"message":"Your message has been sent successfully."}
```

Gmail API acceptance is not a guarantee of inbox placement. There is no durable queue or submission history. If Gmail accepts email but its response or the HTTP response is lost, a retry might send another email; never automatically retry the same CAPTCHA token.

| Status | Meaning / action |
| --- | --- |
| `400` | Invalid fields or failed/expired/reused/wrong-hostname CAPTCHA. Fix the form and obtain a fresh token. |
| `429` | More than three attempts from the tracked IP within 15 minutes. Wait before generating another CAPTCHA. |
| `503` | Missing configuration, unavailable Google verification, rejected CAPTCHA secret, or Gmail API failure. Response contains only a safe message. Nothing was saved for later. |
| `500` | Unexpected server failure. Do not assume delivery succeeded. |

Swagger: `/api/docs`, tag `contact`. The route has no Bearer requirement and documents its request and `200/400/429/503` responses.

## Google setup

1. Register a **reCAPTCHA v2 → “I'm not a robot” Checkbox** site in the [Google reCAPTCHA console](https://www.google.com/recaptcha/admin/create). Use the v2 shared secret compatible with `siteverify`, not a v3 key or an Enterprise assessment API key.
2. Configure the actual frontend domains in Google, keeping domain validation enabled. Use a separate development registration for `localhost`. Do not use the backend Render hostname unless the widget is actually served there.
3. The frontend uses the public **site key**. Put the matching **secret key** only in the Nest backend environment:

   ```env
   RECAPTCHA_SECRET_KEY=your-private-v2-secret
   RECAPTCHA_ALLOWED_HOSTNAMES=localhost,your-actual-frontend.vercel.app
   ```

   Hostnames are comma-separated, case-normalized, and matched exactly. Do not include `https://`, ports, paths, wildcard domains, or a trailing comma. Put only frontend hosts you control on the allowlist. Replace all example domains; changing CORS origins does not automatically update this allowlist.

4. Solve the widget and pass its response as `captchaToken`. Backend sends URL-encoded `secret` and `response` to `https://www.google.com/recaptcha/api/siteverify`, using a five-second timeout. It requires boolean success and an allowed returned hostname before sending email. HTTP/network/malformed-provider errors fail closed with `503`.

Google rejects expired and reused tokens; tokens are valid for two minutes and one verification. After any attempt that may have reached Google, reset the widget and generate a new token. The backend does not store/cache tokens or implement a verification bypass. [Google verification contract](https://developers.google.com/recaptcha/docs/verify)

Google's public v2 test keys are described in its [testing FAQ](https://developers.google.com/recaptcha/docs/faq). They are not proof that a human solved a challenge. This backend rejects Google's public test secret when `NODE_ENV=production`. Prefer a dedicated localhost v2 registration for manual tests so hostname validation remains identical to production. Never disable hostname checks to make test keys pass.

## Gmail API configuration

Contact email now uses the official Google Gmail API client over HTTPS, never SMTP. Follow [Gmail API setup](GMAIL_API_SETUP.md) for Cloud Console, one-time sender consent, refresh tokens, and Render deployment.

```env
GMAIL_CLIENT_ID=your-dedicated-oauth-client-id
GMAIL_CLIENT_SECRET=your-private-client-secret
GMAIL_REFRESH_TOKEN=your-private-offline-refresh-token
GMAIL_SENDER_EMAIL=your-authorized-sender@gmail.com
CONTACT_SUPPORT_EMAIL=your-support-inbox@example.com
```

All five settings are validated when Nest constructs the contact mail provider. Missing credentials or invalid sender/support addresses prevent web startup with a sanitized configuration error; no provider request is made at startup. This intentionally replaces the former submission-time optional SMTP configuration. Configure these settings before deploying. Credentials are refreshed automatically by the OAuth client; no production OAuth callback or visitor authorization is needed.

- Use only `https://www.googleapis.com/auth/gmail.send` for the dedicated sender's consent. Gmail credentials are independent of BlogHub Google Login/Auth.js.
- Sender and support recipient are server-controlled single addresses. Visitor address/name are only structured Reply-To fields. Subject remains `[BlogHub Contact] <subject>`; plain text includes all contact fields.
- The installed MailComposer utility builds MIME headers and UTF-8/Burmese content. Its only role here is message formatting; there is no Nodemailer transport or SMTP request in Contact Us. The complete message is base64url encoded for `users.messages.send`, with `userId: me`.
- OAuth token requests and Gmail send requests have 10-second timeouts; the send also has a 15-second abort signal. Automatic HTTP transport retries are disabled. The Google OAuth client handles access-token refresh; uncertain send outcomes must not be automatically resubmitted.
- Gmail must return a nonempty message ID before success is returned. Provider failures produce the same safe `503` as before; logs contain only `Contact email delivery failed`, never provider error objects, raw MIME, credentials, or visitor content.
- `CONTACT_FROM_EMAIL` is obsolete and may be removed. Keep `SMTP_*` and Nodemailer: the separate password-reset service still uses SMTP and has not been migrated. Its hosting SMTP restrictions are unchanged.

## Rate limits and proxies

The route uses the existing Nest Throttler with a route-specific limit of **3 attempts per IP per 15 minutes**. Invalid form/CAPTCHA attempts that reach the guard also consume attempts. It does not add a global guard or change authentication/FAQ/blog/chat limits.

The installed limiter uses Express `request.ip`, which respects the application's trusted-proxy settings. This checkout does not globally enable `trust proxy`; arbitrary `X-Forwarded-For` and `X-Real-IP` headers do not change the tracked IP. Behind a reverse proxy this can group visitors under the proxy's peer IP, causing shared throttling. Before production rollout, verify the actual proxy topology and peer/IP handling. If changing proxy trust, restrict it to verified ingress addresses/topology and ensure forwarded headers are overwritten there; do not blindly enable `trust proxy=true`, trust arbitrary headers, or use a hop count without validating all ingress paths.

The existing store is in process memory: counters reset on restart and are not shared across replicas. For multiple API instances, use a shared limiter or trusted edge enforcement as a separate operational change. The current implementation adds neither Redis nor another store.

## Postman / manual verification

1. Configure a development v2 Checkbox registration for `localhost`, the matching backend secret/allowlist, and a test support mailbox plus the Gmail settings above. A mock string such as `valid-token` cannot pass a real Google check.
2. Run `npm run start:dev`. No migration or seed is needed. Missing Gmail settings prevent startup.
3. Obtain a fresh token by solving the widget on an approved frontend/development page using the matching public site key. If the widget is already rendered, Google's documented `grecaptcha.getResponse()` retrieves its response. Postman cannot solve the checkbox itself. Do not log or commit that token.
4. In Postman, send the example JSON to `http://localhost:5300/api/v1/contact` with the actual fresh token, JSON content type, and **No Auth**. Submit promptly and check the support mailbox and Reply-To address.
5. Resubmit that same token once: expect `400` and no second email. Generate a fresh token for each further test. Invalid data returns `400`; repeated requests produce `429`, so wait for the window or restart only your local test process before more manual cases.
6. For hostname mismatch, use a development hostname configured in Google but absent from the backend allowlist. Expect `400` and no email. For a secret/configuration error, expect `503`; restore configuration before continuing.

Do not run manual email tests against real support recipients without authorization. Automated tests mock reCAPTCHA fetch and Gmail API send calls.

## Deployment and troubleshooting

1. Set `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES`, `CONTACT_SUPPORT_EMAIL`, and the four `GMAIL_*` settings in the Nest web service environment. Keep secrets out of Git, the browser, and frontend public variables.
2. Confirm outbound Google HTTPS and Gmail API HTTPS connectivity, authorized sender, allowed frontend domains, and proxy/rate-limit behavior. Preserve existing CORS and Helmet settings.
3. Build and deploy the API normally after review. This feature has no worker, database migration, seed, or frontend changes. Nothing was deployed during this migration.
4. `400` CAPTCHA: verify v2 key pairing, solve a fresh widget, submit within Google's window, and check exact hostname allowlists. Tokens must not be reused even after email failure.
5. `503` verification: check required secret/hostnames and Google's reachability. `503` email: check support/sender addresses, Gmail OAuth credentials, OAuth consent, sender authorization, API enablement/quota, and provider settings. Never paste secrets into logs or tickets.
6. `429` unexpectedly: check shared proxy IP behavior and request volume, then wait. A service restart resets the in-memory limiter; it is not an abuse-protection strategy.

## Source map and checks

| File | Purpose |
| --- | --- |
| `src/contact/contact.module.ts` | Contact-only providers and existing Throttler wiring |
| `src/contact/contact.controller.ts` | Public POST, local rate limit, validation pipe, Swagger |
| `src/contact/dto/create-contact.dto.ts` | Field bounds, trimming, header safety, response schema |
| `src/contact/contact.config.ts` | reCAPTCHA and startup Gmail environment validation |
| `src/contact/gmail-mail.service.ts` | OAuth client, MIME formatting, and Gmail API send |
| `src/contact/recaptcha.service.ts` | Timed Google verification and hostname allowlist |
| `src/contact/contact.service.ts` | Validate → verify CAPTCHA → send support email through Gmail API |
| `src/contact/contact.spec.ts` | Validation, reCAPTCHA/Gmail mocks, real HTTP/public access, rate limit, Swagger |
| `src/app.module.ts` | Registers ContactModule |
| `.env.example` | New contact/CAPTCHA settings without credentials |

Run `npm test`, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm run build` with the project's supported Node version (Node 22). Focused tests: `npx vitest run src/contact`. Actual reCAPTCHA verification, live Gmail API delivery, production proxy topology, and inbox placement need separately authorized manual verification.
