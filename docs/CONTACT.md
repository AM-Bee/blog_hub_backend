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

Success: **200** after the SMTP server accepts the message:

```json
{"message":"Your message has been sent successfully."}
```

SMTP acceptance is not a guarantee of inbox placement. There is no durable queue or submission history. If the provider accepts email but its response or the HTTP response is lost, a retry might send another email; never automatically retry the same CAPTCHA token.

| Status | Meaning / action |
| --- | --- |
| `400` | Invalid fields or failed/expired/reused/wrong-hostname CAPTCHA. Fix the form and obtain a fresh token. |
| `429` | More than three attempts from the tracked IP within 15 minutes. Wait before generating another CAPTCHA. |
| `503` | Missing configuration, unavailable Google verification, rejected CAPTCHA secret, or SMTP failure. Response contains only a safe message. Nothing was saved for later. |
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

## SMTP configuration

Reuse the existing Nodemailer package and private SMTP credentials:

```env
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=465
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-private-smtp-password
CONTACT_FROM_EMAIL=verified-sender@your-domain.example
CONTACT_SUPPORT_EMAIL=support@your-domain.example
```

- `CONTACT_FROM_EMAIL` and `CONTACT_SUPPORT_EMAIL` are required **single mailbox addresses**, not display-name lists. They are distinct from `SMTP_FROM`, which remains the password-reset sender setting.
- Verify/authorize the sender with the email provider and configure the provider's required DNS records. If using Gmail, use its supported SMTP credentials/app password configuration.
- Visitor email goes only into structured `Reply-To`; neither sender nor support recipient can be set by the visitor. Subject is `[BlogHub Contact] <subject>`. Plain-text content includes name, email, subject, and message. No HTML, attachments, URL fetching, or file access is enabled.
- Port 465 uses implicit TLS; other SMTP submission ports require STARTTLS. Connection/greeting timeouts are 10 seconds; socket inactivity timeout is 15 seconds. TLS certificate checks remain enabled.
- Missing/invalid contact settings return `503` before email delivery. Configuration is checked on submission, matching the existing optional mail feature pattern, so unconfigured contact does not stop unrelated APIs at startup.
- Provider errors are logged with a fixed category only. Tokens, credentials, visitor message content, and raw SMTP error objects are never logged by the contact module.

**Render:** free web services block outbound SMTP on ports 25, 465, and 587; port 25 is blocked for all Render services. If using SMTP 465/587, use a service/plan that permits it. If remaining on free hosting, adopting an HTTPS email provider would be a separate, explicit change; no provider was silently added here. [Render free-service limitations](https://render.com/docs/free)

## Rate limits and proxies

The route uses the existing Nest Throttler with a route-specific limit of **3 attempts per IP per 15 minutes**. Invalid form/CAPTCHA attempts that reach the guard also consume attempts. It does not add a global guard or change authentication/FAQ/blog/chat limits.

The installed limiter uses Express `request.ip`, which respects the application's trusted-proxy settings. This checkout does not globally enable `trust proxy`; arbitrary `X-Forwarded-For` and `X-Real-IP` headers do not change the tracked IP. Behind a reverse proxy this can group visitors under the proxy's peer IP, causing shared throttling. Before production rollout, verify the actual proxy topology and peer/IP handling. If changing proxy trust, restrict it to verified ingress addresses/topology and ensure forwarded headers are overwritten there; do not blindly enable `trust proxy=true`, trust arbitrary headers, or use a hop count without validating all ingress paths.

The existing store is in process memory: counters reset on restart and are not shared across replicas. For multiple API instances, use a shared limiter or trusted edge enforcement as a separate operational change. The current implementation adds neither Redis nor another store.

## Postman / manual verification

1. Configure a development v2 Checkbox registration for `localhost`, the matching backend secret/allowlist, and a test support mailbox. A mock string such as `valid-token` cannot pass a real Google check.
2. Run `npm run start:dev`. No migration or seed is needed.
3. Obtain a fresh token by solving the widget on an approved frontend/development page using the matching public site key. If the widget is already rendered, Google's documented `grecaptcha.getResponse()` retrieves its response. Postman cannot solve the checkbox itself. Do not log or commit that token.
4. In Postman, send the example JSON to `http://localhost:5300/api/v1/contact` with the actual fresh token, JSON content type, and **No Auth**. Submit promptly and check the support mailbox and Reply-To address.
5. Resubmit that same token once: expect `400` and no second email. Generate a fresh token for each further test. Invalid data returns `400`; repeated requests produce `429`, so wait for the window or restart only your local test process before more manual cases.
6. For hostname mismatch, use a development hostname configured in Google but absent from the backend allowlist. Expect `400` and no email. For a secret/configuration error, expect `503`; restore configuration before continuing.

Do not run manual SMTP tests against real support recipients without authorization. Automated tests mock both Google fetch and Nodemailer.

## Deployment and troubleshooting

1. Set `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES`, both `CONTACT_*_EMAIL` addresses, and `SMTP_HOST/PORT/USER/PASSWORD` in the Nest web service environment. Keep secrets out of Git, the browser, and frontend public variables.
2. Confirm outbound Google HTTPS and SMTP connectivity, verified sender, allowed frontend domains, and proxy/rate-limit behavior. Preserve existing CORS and Helmet settings.
3. Build and deploy the API normally after review. This feature has no worker, database migration, seed, or frontend changes. Nothing was deployed during implementation.
4. `400` CAPTCHA: verify v2 key pairing, solve a fresh widget, submit within Google's window, and check exact hostname allowlists. Tokens must not be reused even after email failure.
5. `503` verification: check required secret/hostnames and Google's reachability. `503` email: check support/sender addresses, SMTP credentials, TLS, provider sender authorization, hosting port restrictions, and provider logs. Never paste secrets into logs or tickets.
6. `429` unexpectedly: check shared proxy IP behavior and request volume, then wait. A service restart resets the in-memory limiter; it is not an abuse-protection strategy.

## Source map and checks

| File | Purpose |
| --- | --- |
| `src/contact/contact.module.ts` | Contact-only providers and existing Throttler wiring |
| `src/contact/contact.controller.ts` | Public POST, local rate limit, validation pipe, Swagger |
| `src/contact/dto/create-contact.dto.ts` | Field bounds, trimming, header safety, response schema |
| `src/contact/contact.config.ts` | Fail-closed environment validation |
| `src/contact/recaptcha.service.ts` | Timed Google verification and hostname allowlist |
| `src/contact/contact.service.ts` | Validate → check settings → verify CAPTCHA → send support email |
| `src/contact/contact.spec.ts` | Validation, Google/SMTP mocks, real HTTP/public access, rate limit, Swagger |
| `src/app.module.ts` | Registers ContactModule |
| `.env.example` | New contact/CAPTCHA settings without credentials |

Run `npm test`, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm run build` with the project's supported Node version (Node 22). Focused tests: `npx vitest run src/contact`. Actual Google verification, live SMTP delivery, production proxy topology, and inbox placement need separately authorized manual verification.
