# WarmAI Tracker

Public source for `warm.js` — the safe-default first-party visitor
tracking script published at `https://assets.warmai.uk/warm.js` by
Warm AI Ltd (United Kingdom).

The script is loaded by Warm AI's paying customers on their own
websites for B2B visitor analytics and company-level identification.

## What it does

Per session, the script captures:
- A session token (UUID, sessionStorage, 30-min idle TTL)
- Page view events (URL, path, title, referrer)
- Active time (visible-tab + recent-input gated)
- UTM parameters from the URL
- User agent (client side); IP address (server side, via Cloudflare proxy)

## What it does NOT do

- No persistent cookies (`warm.js` does not set `document.cookie` at all)
- No form-input scraping — does not read `<input>`, `<textarea>`, or
  `<select>` values
- No fingerprinting (canvas, WebGL, fonts, audio, etc.)
- No third-party network calls — beacons go only to Warm AI's own
  infrastructure (`track.getwarmai.com` and a Supabase fallback)
- No cross-site tracking — each customer's data is siloed by
  tracking ID

## Privacy signals honoured

The script returns immediately and fires no beacons if any of the
following are set:
- `navigator.doNotTrack === '1'` (DNT)
- `window.doNotTrack === '1'`
- `navigator.globalPrivacyControl === true` (GPC)

## Verification

You're reading the canonical source. The file is also published at:
- `https://assets.warmai.uk/warm.js` (deployed copy)
- `https://assets.warmai.uk/warm.min.js` (minified)

Security policy: `https://assets.warmai.uk/.well-known/security.txt`
Privacy disclosure: `https://getwarmai.com/tracker`

## Pro variant

A consent-required variant (`warm-pro.js`) with cross-session
identification and form analytics is **not** open-sourced. It is
gated on customer-side CMP consent and is documented to customers
under contract.

## License

See `LICENSE`. Source-visible, proprietary — provided to Warm AI
customers under contract. You may read the source for audit and
verification purposes; you may not redistribute, modify, or
self-host.

## Reporting issues

Security: `support@getwarmai.com` (we respond within 48 hours UK
business days)

Privacy queries: `support@getwarmai.com`
