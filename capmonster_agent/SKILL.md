---
name: capmonster-mcp
description: How to analyze a captcha-protected page and solve it using the capmonster MCP server (create_task, get_task_result, get_supported_tasks, get_task_parameters, get_docs, get_actual_user_agent, get_balance) as the solve brain, driven by a patchright MCP server (a stealth Playwright browser kept alive across tool calls) that does all page work — navigation, interaction, reading the live DOM/network, and injecting the solution back into the page — and how to turn a solve into a standalone script. Use whenever the user gives a URL with a captcha, asks "what captcha is this / solve this captcha", or wants a reusable script that solves a captcha via CapMonster.
---

# CapMonster MCP + patchright MCP: analyze, solve, scriptify

This is a **strict, ordered procedure**. Follow the numbered steps in order. Do not
reorder them, do not skip a step, and do not improvise a shortcut — in particular,
**do step 2 (`get_supported_tasks`) before you open the page**, and **never write
extraction code before the step-5 docs lookup**. Each step below states what to do
and what must be true before you move on.

## The two servers (roles, never conflated)

- **`capmonster` MCP** (`mcp__capmonster__*`) — the **solve brain**. Backed by
  CapMonster Cloud. It has **no browser**: it lists task types, serves docs, creates
  and polls the solve task. Tools: `get_supported_tasks`, `get_task_parameters`,
  `get_docs`, `create_task`, `get_task_result`, `get_task_result_wait`,
  `get_actual_user_agent`, `get_balance`.
- **`patchright` MCP** (`mcp__patchright__*`, the `mcp-patchright-mainworld` npm package) — the
  **eyes and hands**: a live, stateful, stealth browser (a hardened Playwright fork
  that defeats most automation detection), headed by default, that keeps one browser
  context alive across tool calls. Everything that touches the page goes through it:
  navigation, clicks/typing/submits, reading the live DOM/network, and injecting the
  solution. `browser_navigate` auto-starts a session with sane defaults; call
  `browser_start` explicitly only to set non-default options (proxy, userAgent,
  locale, geolocation, etc. — see "Two kinds of proxy" below).

  > **`browser_evaluate` runs in an ISOLATED world by default — page globals are
  > invisible there.** For stealth, JS runs in an isolated context that shares the DOM
  > but NOT the page's `window`: reading a page global (`window.grecaptcha`,
  > `v_appId`, …) or **calling a page-registered callback** returns `undefined` /
  > "is not a function". To reach them, pass **`world:"main"`** to `browser_evaluate`
  > (or `browser_run_code_unsafe`) — it runs in the page's real world. Use `"main"`
  > for callback-style injection (Step 8); keep the default (isolated) for plain
  > DOM/identify reads. (This is what the `-mainworld` package adds over upstream.)

  > **`browser_save_blob` writes a `browser_evaluate`-style result straight to a file —
  > it never returns the value through this tool's own response.** Use it (with
  > `create_task`'s `task_file` param, see Step 6) any time a task needs a large/opaque
  > blob (several base64 images, a full page's HTML, …): typing or re-pasting such a
  > value into another tool call's arguments by hand risks silently corrupting it.

There is exactly one browser (patchright's). Do all page work in patchright and all
solving in capmonster.

## Where to stop (decide this before you start)

The user's goal sets the finish line. Read it, pick one, and stop there:

- **"Is this captcha type supported?"** → finish after **Step 4** (identified the
  vendor and confirmed it maps to a supported task type). Do not solve.
- **"Does CapMonster return a token on this page?"** → finish after **Step 7**
  (a successful `get_task_result`). Do not inject.
- **"Give me a working / reusable solve (script)"** → go all the way through
  **Step 8** (injection verified), then Step 9 if a standalone script was requested.

Announce which finish line you're working toward at the start.

## Two kinds of proxy — don't conflate them

A user-supplied proxy can go to two completely different places, and they're not
interchangeable — but for IP-bound challenges (see below) you usually need it in **both**
places at once, not either/or:

- **Solver proxy (CapMonster).** Passed as fields *inside the task object* of
  `create_task` — `proxyType`, `proxyAddress`, `proxyPort`, `proxyLogin`,
  `proxyPassword` (some vendors nest none of this; it's top-level on the task). **This
  needs NO file edit and NO restart.** Authentication is fine here — a `user:pass` proxy
  just goes into `proxyLogin`/`proxyPassword`, no script needed (the auth limitation
  below is *browser*-proxy only).
- **Browser proxy (patchright).** Makes the *page itself* load through the proxy.
  Passed as a **tool-call parameter**: `browser_start(proxy={server, username,
  password, bypass})`. This genuinely authenticates — confirmed by live test against
  two different auth proxies (`user:pass@host:port`, distinct geos), each producing
  the expected, distinct exit IP with no `407`. No `.mcp.json` edit and no restart
  needed for either an authenticated or an unauthenticated browser proxy.

  **Launch-time only:** the proxy (like `userAgent`, `locale`, `channel`, and other
  launch options) is baked into the OS browser process at start — calling
  `browser_start` again on an *already-running* session with a different proxy now
  raises an explicit error rather than silently keeping the old one (confirmed live
  pre-fix: same context, unchanged exit IP, no error). To actually switch proxies:
  `browser_close` first, then `browser_start` with the new `proxy` — a single extra
  tool call, but it **is** a fresh browser context (cookies/DOM/challenge state lost),
  same as any other context reset.

**If either side needs a proxy at all, both sides usually need the SAME one.** A proxy
requirement is a signal that the challenge (or the token/cookie it produces) is IP-bound —
that's *why* DataDome/Imperva/TSPD/Hunt/`cf_clearance` mandate one in the first place. So
the moment you add a solver proxy because the target won't accept a proxyless token, also
route the browser itself through that same proxy (`browser_start(proxy={...})`) — and vice
versa: if the browser is already on a proxy for some other reason (e.g. a region-gated
page), put the identical `proxyType`/`proxyAddress`/`proxyPort`/`proxyLogin`/
`proxyPassword` on the `create_task` object too. One exit IP for both halves of the flow.
Solving "as" an IP that never actually loaded the page (or injecting into a browser on a
different IP than the one CapMonster solved from) is a common, easy-to-miss reason a
token/cookie comes back valid from CapMonster but still gets rejected by the target. The
one exception is a proxy the user hands you purely to *reach* a geo/network-restricted
page that has no IP-bound challenge at all — that's browser-only, nothing for the solver
to match.

### Testing a user-supplied proxy — do it FIRST, and FAST

The moment the user hands you a proxy (or a list), **verify it before you build anything
on it** — a dead, slow, or TLS-intercepting proxy wastes solves and minutes. Spend a few
seconds per proxy with `curl`, not a full browser run. Note `curl -x` tests the **proxy
itself** (reachable, exit IP, latency), not the browser. `curl` handles `user:pass@` auth
directly, so a green curl only confirms the proxy is alive and its exit IP/geo — it does
not by itself prove the browser will authenticate through it, so curl-test first for
speed, then do one real `browser_start(proxy=...)` + `browser_navigate` +
read-the-exit-IP pass to confirm patchright itself authenticates (confirmed reliable
live).

```bash
# reachability + exit IP + latency (neutral endpoint)
curl -s -x "http://user:pass@host:port" https://api.ipify.org --max-time 20 -w " %{time_total}s\n"
# does it cleanly tunnel HTTPS to the TARGET, or MITM the cert / drop the tunnel?
curl -s -o /dev/null -w "target HTTP %{http_code}\n" -x "http://user:pass@host:port" https://<target>/ --max-time 25
```

Read the results before spending a solve:
- **`ERR_CERT_*` / cert-mismatch in a browser but curl "works"** → the proxy is doing
  **TLS interception (MITM)**. Unusable for a real browser session against the target —
  drop it. (curl against `ipify` won't reveal this; the cert check against the *target*
  domain will.)
- **`000` / connection closed / tunnel failed** → dead or flaky exit — drop it.
- **high latency (multi-second)** → likely to trip `ERROR_RECAPTCHA_TIMEOUT` on the
  CapMonster solver ("slow proxy server"). Prefer the fastest working ones.
- **clean `200` on ipify AND a proper response (e.g. `403` CF challenge, not a cert
  error) on the target** → good candidate; use it.

Given a **list**, curl-test them all up front, rank by (works-on-target, low-latency),
and try the good ones first. Tell the user the shortlist before running. Never silently
iterate a big list in a long-running process (see the visibility rule below).

---

## Step 1 — Intake (ask before touching anything)

Ask the user, and wait for the answer:

1. **Is the captcha directly on the URL, or must it be triggered** by a click, form
   submit, scroll, or login? (This decides whether Step 3 needs a gating interaction.)
2. **Any hints?** e.g. the URL is only reachable via a specific proxy, extra headers
   are required, a login is needed, the captcha only appears for certain regions/UAs.
   If the user offers a proxy, work out whether it needs to go on the solver
   (`create_task`), the browser (`browser_start`), or — for IP-bound challenge types
   (DataDome, Imperva, TSPD, Hunt, `cf_clearance`, or any type the docs mark proxy fields
   `required` for) — **both** (see "Two kinds of proxy" above).

Do not guess these — they change the whole run. If the user already told you, restate
your understanding and proceed.

## Step 2 — `get_supported_tasks()` FIRST (before opening the page)

Call `get_supported_tasks()` and load the list of supported task types into context.
You will match whatever you see on the page against **this** list in Step 4, so you
must have it before you look at the page. Note which entries are top-level types
(e.g. `RecaptchaV2Task`, `TurnstileTask`) and which are `CustomTask` classes
(e.g. `DataDome`, `Imperva`, `TenDI`) — see Step 5.

Do not proceed to Step 3 until you have the task-type list.

## Step 3 — Open the page in patchright

`browser_navigate(url)`. Patchright clears most anti-bot interstitials (Cloudflare
"Just a moment…", Akamai/DataDome) on its own. Then, **based on the Step-1 answer**:

- If the captcha must be triggered, perform the gating interaction now
  (`browser_click`, `browser_type`, `browser_fill_form`, `browser_press_key`) so the
  challenge actually renders.
- If the user gave hints (proxy-only, headers, login), honor them here. A **UA-based**
  block can use `get_actual_user_agent()`. An **IP-reputation** block that stealth can't
  clear needs a *browser* proxy — see "Two kinds of proxy" above: `browser_start(proxy=
  {server, username, password})` (authenticated or not, no `.mcp.json` edit needed). A
  proxy the user gives for *solving* (IP-bound token, DataDome/Imperva) does not belong
  here — it goes into `create_task` in Step 7.

## Step 4 — Identify the captcha (match against the Step-2 list)

Read the **live** page and match what you find against the supported-task list from
Step 2, using the marker table below. Read markers via `browser_snapshot` (structure),
`browser_evaluate` (DOM/globals/hidden fields), and `browser_network_requests`
(challenge XHR URLs — many vendors put the param you need straight in the URL).

### Aggregate marker table — what to look for on the page

> **This table is a starting index, NOT the source of truth.** It's a snapshot that
> can drift behind the live API — task types get added/renamed, required fields and
> solution shapes change, and CustomTask classes move to top-level types (or vice
> versa). Use it only to recognize the vendor and know *roughly* where to look. Before
> you call `create_task` you MUST confirm the exact type, field list, nesting, and
> solution shape against the live docs in **Step 5** (`get_docs` + `get_task_parameters`).
> If this table and the live docs disagree, the docs win — trust them and ignore the
> table.

The **Task type** column is the exact CapMonster task type / `CustomTask` class name
(verified against `get_supported_tasks` at the time of writing). Entries marked
**CustomTask · `<class>`** are NOT standalone types — the task object is
`{"type":"CustomTask","class":"<class>","metadata":{…}}`.

This table exists to **recognise the vendor and pick the task type** — nothing more. It
deliberately does **not** list required fields or the solution shape: those come from
`get_task_parameters` + `get_docs` in Step 5 (the authoritative, current source), and a
duplicated copy here would only drift out of date. "What to pull" names the raw values to
read off the page so you know what to look for; Step 5 tells you which task fields they
map to and how they nest.

| What you see on the page / in network | Vendor | What to pull | Task type |
|---|---|---|---|
| `class="g-recaptcha" data-sitekey="..."`, `grecaptcha.render(...)`, `/recaptcha/api2/anchor` | reCAPTCHA v2 | `data-sitekey`, any `data-s` value | `RecaptchaV2Task` |
| `enterprise.js`, `grecaptcha.enterprise.render(...)` | reCAPTCHA v2 Enterprise | `websiteKey`, any `s` data | `RecaptchaV2EnterpriseTask` |
| `grecaptcha.execute(..., {action: ...})`, `/recaptcha/api.js?render=<key>` | reCAPTCHA v3 | `websiteKey`, the `action` string | `RecaptchaV3TaskProxyless` |
| `data-pkey`, `/fc/gt2/public_key/…`, Arkose/FunCaptcha script | FunCaptcha (Arkose) | `pk` (→ `websitePublicKey`), `surl` (→ `funcaptchaApiJSSubdomain`), `data[blob]` if used | `FunCaptchaTask` |
| `class="cf-turnstile" data-sitekey="..."` | Turnstile | `data-sitekey` | `TurnstileTask` |
| Cloudflare interstitial / managed challenge (no cf-turnstile div) | Cloudflare Challenge | page URL, UA, `cloudflareTaskType` + `htmlPageBase64`/`pageData` per mode | `TurnstileTask` (`cloudflareTaskType`) |
| `initGeetest(...)`, `gt`+`challenge` in `api.geetest.com/gettype`/`init-params` XHR | GeeTest v3 | `gt`, `challenge` (re-fetch fresh each time) | `GeeTestTask` (`version:3`) |
| `initGeetest4(...)`, `captcha_id` in `gcaptcha4.geetest.com/load` XHR | GeeTest v4 | `captcha_id` (→ `gt`), `risk_type` | `GeeTestTask` (`version:4`) |
| `service.mtcaptcha.com/.../getchallenge.json?sk=MTPublic-…&act=…` | MTCaptcha | `sk` (→ `websiteKey`), `act` (→ `pageAction`) | `MTCaptchaTask` |
| `captcha-delivery.com/captcha`, `var dd={...}` script, `datadome` cookie | DataDome | `captchaUrl` (built from `dd` obj), `datadome` cookie | CustomTask · `DataDome` |
| `405` page + `window.gokuProps`, `*.awswaf.com` `challenge.js`/`captcha.js`/`jsapi.js`, `aws-waf-token` cookie | AWS WAF | `gokuProps.key`/`.context`/`.iv`, `challengeScript`/`captchaScript` URLs, or `apiKey`+`jsapi.js` | `AmazonTask` |
| `get?referer=`/`check?referer=` XHR to `*.dun.163.com`, NECaptcha widget | Yidun (NECaptcha) | `websiteKey` (the `id`), `websiteURL` (the `referer`); Enterprise also `challenge`,`hcg`,`hct`,`yidunGetLib`,`yidunApiServerSubdomain` | `YidunTask` |
| `TCaptcha.js`/`TCaptcha-global.js`, `cap_union_prehandle?aid=…`, Tencent widget | TenDI (Tencent) | `aid` (→ `websiteKey`), captcha JS URL (→ `metadata.captchaUrl`) | CustomTask · `TenDI` |
| `#main-iframe`, `_Incapsula_Resource?…`, `visid_incap_*`/`incap_ses_*` cookies | Imperva (Incapsula) | `incapsulaScriptUrl`, the `incap_`/`visid_incap_` cookies, `reese84` endpoint | CustomTask · `Imperva` |
| `securityId`/`validateId` in Binance `bcaptcha` flow | Binance | `websiteKey`, `validateId` (dynamic) | `BinanceTask` |
| Prosopo widget / `procaptcha` markers | Prosopo | `data-sitekey` (→ `websiteKey`) | `ProsopoTask` |
| Friendly Captcha widget, `widget.module.min.js`/`site.min.js` | Friendly | `data-sitekey`, the api-get-lib JS URL | CustomTask · `friendly` |
| Alibaba/AliCloud slider, `sceneId` in captcha init | Alibaba | `sceneId`, `prefix` (subdomain), api-get-lib | CustomTask · `alibaba` |
| `altcha-widget`, hidden `altcha` input, `challenge`/`salt`/`signature` JSON | Altcha | `challenge`, `iterations` (maxnumber), `salt`, `signature` | CustomTask · `altcha` |
| TSPD challenge page (Thales/`TS…` cookies, JS challenge) | TSPD | the TSPD cookie, whole page HTML | CustomTask · `tspd` |
| Hunt captcha widget, `api.js` from the Hunt vendor | Hunt | the `api.js` URL, `meta.token` (solving mode only) | CustomTask · `HUNT` |
| Basilisk widget / `data-sitekey` | Basilisk | `data-sitekey` (→ `websiteKey`) | CustomTask · `Basilisk` |
| A single image to transcribe (no JS challenge) | image-to-text | the image (URL or base64) | `ImageToTextTask` |
| Rotate/grid/coordinate/audio image puzzle (baidu, shein, bls, oocl, …) | ComplexImage | the challenge images + task class | `ComplexImageTask` |

Note the CapMonster type names that do **not** match the vendor's own name: AWS WAF →
`AmazonTask`, Yidun → `YidunTask`, Tencent → `CustomTask · TenDI`, Incapsula →
`CustomTask · Imperva`.

**hCaptcha is NOT supported.** CapMonster's own marketing tagline (in `llms.txt`) lists
"hCaptcha", but that line is stale/aspirational: there is no hCaptcha task type, no
`class`, and no hCaptcha page anywhere in the docs, and the FAQ's supported-types list
omits it. `get_supported_tasks` is authoritative — it returns no hCaptcha type. So if you
positively identify hCaptcha, say so and treat it as **unsupported**; do not force it onto
a reCAPTCHA type, and don't be talked out of that by the tagline.

**CustomTask vs. top-level type:** DataDome, TenDI, Imperva, altcha, tspd, HUNT,
alibaba, friendly, and Basilisk are `{"type":"CustomTask","class":"<class>", …}` (class
names exactly as written above — several are lowercase). MTCaptcha, Yidun, Amazon,
Binance, Prosopo, GeeTest, Turnstile, FunCaptcha, and the reCAPTCHA family are
top-level types. Step 5 confirms the exact shape before you build the task.

**Proxy-mandatory types:** **DataDome, Imperva, TSPD, Hunt, and Cloudflare Challenge in
`cf_clearance` (cookie) mode** require *your own* proxy and fail immediately without one —
ask the user for a proxy in Step 1 if you expect any of them, and route it to **both** the
solver and the browser (see "Two kinds of proxy" above — these are exactly the IP-bound
types that rule applies to). TSPD additionally needs a **static session** (the same exit
IP across every stage of the solve). Everything else defaults to CapMonster's built-in
proxies and needs no proxy unless the site rejects the token or blocks the built-in IPs.
(Confirm per-type in Step 5 — the docs mark the proxy fields `required` for the mandatory
types.)

**If the user's proxy uses IP-based authorization** (whitelisted IP instead of
user:pass), CapMonster's solver IP **`65.21.190.34`** must be added to the proxy's
allow-list, or every proxied task fails. This applies to the solver proxy (the fields on
the `create_task` object), independent of the browser proxy.

If you don't see a captcha, don't conclude there isn't one — rule out, in order:
(1) an **interaction gate** (do the gating interaction, re-read); (2) **timing**
(`browser_wait_for` a marker, re-snapshot); (3) an **IP-reputation block** (needs a
proxy); (4) a **vendor outside this table** (check `get_supported_tasks()` by the
vendor's own script-domain/class name). Only then conclude "no supported captcha".

**Finish line check:** if the goal was only "is it supported?", stop here — report the
identified vendor and its supported task type.

## Step 5 — MANDATORY docs lookup (read the WHOLE per-vendor page, not greps, never the full dump)

Once you've identified a captcha, you **must** consult the docs before writing a single
line of extraction code. This gate is not optional and not skippable. The Step-4 table
is only an index — it does not count as "consulting the docs" and may be out of date,
so confirm the type and fields here even when the table already looks complete.

> **⚠️ Read the ENTIRE doc page for the solved type — do not grep it in fragments.**
> The vendor page is the source of truth, and its **worked "Examples of solving…"
> section is the canonical flow** — often materially different from the Step-4 table and
> from the parameter-*extraction* snippet earlier on the same page. Skim only the marker
> table + "How to find parameters" snippet and you'll miss the real create/solve/inject
> recipe and reinvent a broken one.

1. **`get_docs(url)` on the ONE per-vendor page — never the full dump.**
   Fetch the llms.txt index at `https://docs.capmonster.cloud/llms.txt` first (if you
   don't already have it) and pick that vendor's single doc URL from it. **Do not call
   `get_docs("https://docs.capmonster.cloud/llms-full.txt")`** — it's a ~650KB dump of
   *every* captcha type concatenated; it is not a valid substitute for the per-vendor
   page and must not be used as a routine fallback.
   Some per-vendor pages are themselves large (e.g. the Cloudflare Challenge page, which
   covers several `cloudflareTaskType` modes with full worked examples per language) and
   won't fit in one call. **Prefer jumping to sections over paging by hand:** the first
   chunk of a large page is prefixed with a **section outline** listing every `##`/`###`
   heading and the exact `section="…"` string to fetch it. Then call
   `get_docs(url, section="Examples of solving")` (or `section="Create task"`,
   `section="Get task result"`, etc. — matching is case-insensitive substring) to get that
   whole section, nested subsections included, in one call. If you'd rather read raw, the
   page also paginates: each chunk carries a `[chars X-Y of TOTAL … call again with
   offset=Y]` header — **keep calling `get_docs(url, offset=Y)` until it says "end of
   document"**, don't stop at the first chunk. Either way you must actually cover the whole
   relevant page — do not settle for a few greps — including, at minimum, all of:
   - the **request-parameters** section (required vs optional, nesting, enums, and any
     mode selector like `cloudflareTaskType` with each of its values);
   - the **`## How to find all required parameters`** section (how to extract each param
     from a live page — this is *parameter extraction*, not the solve recipe);
   - **every `## Create task` / `## Get task result` variant** for the mode you're in;
   - the **`## Examples of solving …`** section — the end-to-end worked flow (fetch →
     createTask → poll → inject → verify). **This is the recipe you follow.** If a
     language example exists (Python/Node/C#), read it line by line and mirror its
     control flow, its headers, and how it obtains and encodes the HTML/params.
   If — and only if — the vendor genuinely has no entry in the llms.txt index (so no
   per-vendor URL exists), that's the one case where the full dump is a last resort:
   say so explicitly, then hand `get_docs("https://docs.capmonster.cloud/llms-full.txt")`
   to a subagent (Agent tool) to extract and summarize just that vendor's section — never
   read the full dump inline yourself. (`get_docs` only fetches `docs.capmonster.cloud` /
   `api.capmonster.cloud` URLs.)
2. **`get_task_parameters(task_type)`** — the live, authoritative field list for that
   exact type or `CustomTask` class (required vs. optional, nesting, enums).

Cross-check the two. If they disagree, trust `get_task_parameters` (it reads the
current OpenAPI spec) and note the discrepancy. Do not extrapolate a shape from a
different vendor's task, and do not settle on a plausible-sounding type name on the
strength of only one source. Some types require a proxy to solve at all — if the docs
list proxy fields, treat that as a signal, and if the user gave no proxy, be ready to
ask for one in Step 7.

**Follow the doc's worked example over your own instinct.** When the "Examples of
solving…" section shows a specific way to obtain the challenge HTML/params (e.g. a raw
HTTP fetch vs. a browser render), do it *that* way first. Only deviate if it verifiably
fails, and say why. Details that look cosmetic are often load-bearing: the exact header
set (incl. `sec-ch-ua`/`sec-ch-ua-platform`), the `Accept-Encoding` value, whether the
HTML is taken as decompressed **text** then base64'd (not raw/compressed bytes), and the
UA matching between solve task and browser. See Step 6 for the encoding pitfalls.

## Step 6 — Write the extraction script and RUN it via patchright

Write a JS `detect()`-style function that pulls exactly the parameters Step 5's docs
say this task needs (sitekey/pkey/captchaId/action/cookies/URL — whatever the field
list requires), then **execute it on the live page with `browser_evaluate`** and read
back what it returns. Do not just write it — run it and verify:

- every required field from `get_task_parameters` is present and non-empty;
- each value matches the shape the docs describe (a sitekey looks like a sitekey, a
  captchaId like a captchaId, etc.).

`browser_evaluate` runs arbitrary JS on the live page — it sees the rendered DOM,
JS-injected nodes, hidden input values, and JS globals, so it's how you both extract
and confirm. Example one-pass probe (adapt selectors/regex to the vendor):

```js
() => {
  const html = document.documentElement.outerHTML;
  const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) || null;
  return {
    recaptchaSitekey: attr('.g-recaptcha, [data-sitekey]', 'data-sitekey'),
    funcaptchaPkey:   attr('[data-pkey]', 'data-pkey'),
    turnstile:        /class="cf-turnstile"/.test(html),
    inlineSitekey:    (html.match(/sitekey["']?\s*[:=]\s*["']([\w-]+)/i) || [])[1] || null,
    globals: {
      grecaptcha: typeof window.grecaptcha,
      hcaptcha:   typeof window.hcaptcha,
      turnstile:  typeof window.turnstile,
      geetest4:   typeof window.initGeetest4,
    },
    gRecaptchaResponse: document.querySelector('#g-recaptcha-response')?.value || null,
  };
}
```

`browser_network_requests` gives URL + status only. If you need a response body, refetch
from the page's own context: `async () => (await fetch('<challenge URL>')).text()`. To read
a cross-origin iframe challenge, target that frame or read its `src` + XHRs.

**This in-page refetch is a NEW request, not a replay — it can silently return a different
state than the one you observed.** This isn't about the resource being "static" or "dynamic"
as a fixed property; it's about the gap in time between when you saw a state (e.g. a 403) and
when you issue the fetch. Anything can change in that gap: a challenge that self-clears in the
background, a session/cookie that expires or advances, a poll-driven redirect, a widget that
re-renders. The page (or the server behind it) keeps moving on its own clock, independent of
you, between tool calls — even ones that look purely observational. A `fetch()` issued after
the fact — even from `browser_evaluate`/`browser_save_blob` in the same page context — hits
the server fresh and gets back **whatever is true now**, which can be silently different from
what you meant to capture: no error, no warning, just the wrong body. Never assume "I saw X a
moment ago, so a fetch now will still return X" — verify what you actually got (see the
mandatory check below) instead of trusting the timing.

**Cloudflare's live managed challenge ("Just a moment...", `cType: 'managed'`) is the
concrete case this bit — do not in-page-refetch it for `cf_clearance` capture.** Once the
browser has landed on the 403, Cloudflare's own JS keeps orchestrating the challenge in the
background, and on a trusted-enough IP it can pass on its own within seconds. Sending a
stale, already-cleared 200 page as `htmlPageBase64` produces `ERROR_CAPTCHA_UNSOLVABLE`
(there's no `cData`/`chlPageData`/challenge script left in it to solve), which reads as a
solver problem but is actually a stale-capture problem — confirmed live: a `browser_save_blob`
fetch issued a few tool-calls after the 403 silently returned the already-cleared 200 page
twice in a row. The fix: **capture with a one-shot request outside the browser entirely** —
`curl`/`requests`/`fetch` in a throwaway process, through the *same proxy* you'll pass to
`create_task`, with no JS execution and no session to race against. Nothing else can "finish
solving" a request that isn't attached to a live browser tab, so whatever status/body comes
back is final and matches the JSON `createTask` will receive. This is also what the vendor's
own worked examples in Step 5 do (`fetch(URL)`/`requests.get(URL)`, no Playwright) — treat it
as the default for `cf_clearance` capture, not a fallback. Patchright's tools don't expose the
navigation response's own body directly (only `status`/`url`/`title`), so there is no
equivalent atomic capture from the live browser session — don't try to improvise one.

**Mandatory check before `create_task`, for any capture of a page that can transition on
its own:** decode the captured HTML (or check the captured status/title) and confirm it's
actually the state you meant to capture — for `cf_clearance`, `status == 403`, title
`"Just a moment..."`, and the body contains `cType`/`cRay`/`chlPageData`-style markers —
**before** writing it into the task file. If any of that is missing (title is the real page,
status is 200), the capture is stale: discard it and capture again. Do not send a
capture you haven't checked.

All params must come from the **same** page state — challenge IDs are typically
single-use and session-bound, so re-run the extraction after any navigation/reload and
never mix a value read before an interaction with one read after.

When a task needs a page-HTML snapshot (`htmlPageBase64` etc.): capture it the way the
Step-5 example does (often a raw HTTP fetch, not browser `page.content()` — a rendered
page may have spent its single-use challenge token). base64 the **decompressed HTML
text** (`resp.text.encode("utf-8")`), not raw/compressed `resp.content`, and don't
request encodings you can't decode (drop `br` unless brotli is installed). Keep the
`userAgent` in the task, the fetch's client-hint headers, and the browser all on one
fingerprint — solutions are bound to it.

**For Cloudflare `cf_clearance` specifically, this "raw response body, not a re-serialized
DOM" rule is not optional.** Capture `htmlPageBase64` from the network response body
(`response.body()`/`response.text()` off the navigation response), never from
`document.documentElement.outerHTML` or any other post-render DOM read — `outerHTML`
reflects the *parsed-and-possibly-mutated* DOM (attributes normalized, tags reflowed),
not the exact bytes Cloudflare's challenge issued, and the single-use tokens CapMonster
needs from the HTML (`cData`/`chlPageData`-equivalents, CSP nonces) are set by the page's
own inline bootstrap script — so don't block `<script>` requests before capturing either,
even to stop the page from self-refreshing away from the fresh 403; that prevents the same
bootstrap from running and can strip the very tokens the capture is meant to preserve. If
a `cf_clearance` task keeps coming back unsolvable, check whether the HTML was captured
via a DOM read instead of the raw response body before concluding the target itself is
unsolvable.

**Never round-trip a large payload through your own context and back into an MCP tool
call — this is not just an `htmlPageBase64`/`cf_clearance` thing.** The same failure
hits **`ComplexImageTask`** whenever the challenge has multiple images (grids like
`bls_3x3`, multi-frame puzzles, …): each image is its own base64 blob, and the *combined*
`task` payload can get large even though every individual field looks small on its own.
**Rule of thumb: if the `task` object you're about to pass to `create_task` holds one or
more base64/opaque blobs — whether it's one big field or several smaller ones added
together — don't type/paste it by hand — generate and send it from a script.**
Concretely: a full HTML page base64'd (`cf_clearance` and similar modes) can be hundreds
of KB to several MB; a `ComplexImageTask` with several images can add up well before any
single field looks alarming.

**Where the corruption actually happens (confirmed by live reproduction — not a theory):**
it is not the MCP transport and not `create_task`'s own code that drops or truncates
data — both faithfully pass through whatever JSON they receive. The failure point is
**you** typing/reproducing a 5-50 KB base64 literal by hand inside a tool-call argument,
copied from something you read a few turns ago in your own context. Over that length, a
dropped character, a duplicated chunk, or — most commonly — an unclosed quote partway
through one of several concatenated base64 strings, silently merges what should be N
separate array elements into one garbled element. This is exactly why the observed
symptom for a 9-image `bls_3x3` task was CapMonster reporting **"Image count: 1, but the
task supports: 9"** — a perfectly valid JSON array, just one element instead of nine,
because a quote never closed and swallowed the rest. Small, easily-typed values (short
IDs, a handful of characters) never trigger this; only genuinely long opaque blobs do.
Confirmed independently: the exact same 9-image payload, generated and sent by a script
in one process, was accepted and solved on the first try — see `DEV_RESPONSE.md` in the
repo root for the full repro.

Reading the blob(s) via `browser_evaluate`/`browser_get_visible_html` (or collecting
several images) and then re-typing or re-pasting them into `create_task`'s arguments
burns huge amounts of context, is slow, and risks this **silent corruption** — a
cut-off/garbled payload is not rejected with a clear "too big" error; CapMonster just
reports whatever generic error matches the broken data it received (e.g.
`ERROR_ZERO_CAPTCHA_FILESIZE`, `InputValidationError`, "Image count: N instead of M"),
which reads as a solver/task-config problem and sends you chasing the wrong root cause.
The moment a task needs one or more of these opaque blobs, stop working turn-by-turn
through tool calls with the blob typed inline, and use one of these instead:

1. **`browser_save_blob` + `create_task(task_file=...)`** (preferred when the patchright
   MCP exposes `browser_save_blob`, **except** for `cf_clearance`/managed-challenge HTML —
   see the "unsafe for a live Cloudflare managed challenge" warning above; use a one-shot
   out-of-browser request for that specific case instead, still saved to a file the same
   way) — the file-to-file path, no script needed:
   - Build the full task object *inside the page* (or with a couple of `browser_evaluate`
     calls) as a single JS object holding `type`, `imagesBase64: [...]` (or
     `htmlPageBase64`, etc.), and `metadata` — everything `create_task` needs.
   - `browser_save_blob({expression: "JSON.stringify({...task object...})", path: "<scratch
     path>/task.json"})` writes it straight to disk. The blob's bytes never appear in this
     tool's response and never pass through your own context.
   - `create_task(task_file="<scratch path>/task.json")` — the capmonster MCP reads the
     JSON off disk itself and posts it verbatim. You never see or retype the blob.
   - Then `get_task_result_wait(task_id=...)` as normal.
2. **A standalone script** (Node/Playwright or plain HTTP client) — when `browser_save_blob`
   isn't available, or the flow needs more control (a raw HTTP fetch of an HTML page rather
   than a browser render, custom headers, a proxy): in one process, fetch/capture the
   blob(s), base64 them, POST directly to the CapMonster REST API (`/createTask`, then poll
   `/getTaskResult`), and print just the final solution/status. Run it per Step 9's guidance
   on foreground execution with visible progress.

Either way, the blob's bytes are generated on one side (the page, or the script's own fetch)
and consumed on the other (a file `create_task` reads, or a direct API POST) — they never
pass through a tool-call argument you had to type or copy by hand. The same applies to any
other single-shot large field a vendor's docs call for (e.g. a full challenge JSON dump).

## Step 7 — Create the task and poll (loop on error)

`create_task(task={...})` with the extracted params, then collect the result
with `get_task_result_wait(task_id=...)`, which polls to completion for you (respecting the
2 s-minimum interval and 120-poll cap). Use `get_task_result(task_id=...)` only if you want
to drive the loop yourself — poll no faster than once per 2 s, and don't dawdle: a task
result is stored for only **~5 minutes** before it expires (`ERROR_NO_SUCH_CAPCHA_ID`).

- **On error** → recheck the docs (Step 5), recheck the live page and the extraction
  output (Step 6), correct the task object, and `create_task` again. Loop until the
  result is a real solution, not an error. A **proxy-related error** comes back almost
  immediately — if it does and no proxy was supplied, ask the user for one and add it
  as the `proxyType`/`proxyAddress`/… fields *on the task object* (this is the solver
  proxy — no `.mcp.json` edit, no restart; see "Two kinds of proxy"). (Still
  "processing" after several polls is a mildly good sign, not a reason to abandon.)
  **`ERROR_CAPTCHA_UNSOLVABLE` on the first attempt, with parameters you've already
  verified are correct, is often transient** — confirmed live and repeatedly (5+ times
  across different sites/types): a second `create_task` with the *identical* task object
  frequently succeeds where the first one reported unsolvable. Retry once with the same
  parameters before concluding the params themselves are wrong or re-extracting anything —
  only fall back to re-checking params/docs if the retry also fails.
- **On success** → read the solution. **Read the solution's shape from that vendor's
  docs** (Step 5) before extracting a field — the result's `solution` is CapMonster's
  raw solution verbatim, and both the field names (`gRecaptchaResponse`, `token`,
  `cookie`, `ticket`+`randstr`, …) and the nesting vary by type. Extract defensively. If
  the solution carries its own `userAgent` / `headers["User-Agent"]` (Cloudflare
  Challenge, FunCaptcha, AWS WAF, Binance, TenDI, Basilisk), the token is bound to **that**
  UA — carry it into Step 8's injection and any follow-up requests (keep the whole solve on
  one UA; see `get_actual_user_agent`).

**Finish line check:** if the goal was only "does CapMonster return a token?", stop
here — report the solution.

## Step 8 — Inject the solution and verify (in-session)

Read the injection example in the vendor's docs (Step 5's page carries it); if there's
no example, derive it from the widget. Apply it in the live patchright context with
`browser_evaluate` / `browser_click`, then verify:

| Solution shape | How it's applied | patchright tools |
|---|---|---|
| Cookie (AWS WAF `aws-waf-token`, DataDome, Imperva) | Seed into the real cookie jar so page JS reading `document.cookie` sees it, then reload | `browser_evaluate` (`document.cookie = ...`) or `browser_navigate` with cookie set |
| Token into a hidden field + submit (reCAPTCHA v2/v3, most `*Task`) | Set `<textarea id="g-recaptcha-response">` (or equivalent), then submit | `browser_evaluate` to set + `browser_click`/`browser_evaluate` to submit |
| Direct JS callback (Turnstile and widgets with a registered `callback`) | Call e.g. `window.turnstileCallback(token)` directly — **must run in the page's main world** | `browser_evaluate({expression:"window.turnstileCallback('<token>')", world:"main"})` (without `world:"main"` the callback is `undefined` — see the isolated-world note in "The two servers") |
| DOM manipulation + synthetic events (Altcha, custom widgets) | Set hidden inputs + widget state, dispatch a synthetic `change`/`click` | `browser_evaluate` to set + `dispatchEvent`, or `browser_click` |
| Click coordinates (`ComplexImageTask`, image-grid) | Real mouse clicks on returned cells | `browser_click` on the cells |

**If a form submit via `browser_evaluate` (e.g. `form.submit()` or a JS `element.click()`
on the submit button) doesn't seem to trigger the page's handler** — observed once live
on `eznamka.sk`, where the form's own JS listener was apparently waiting for a real
browser-originated click event and ignored the synthetic one — it's worth trying
`browser_click` on the button instead of a JS-triggered click. Not a hard rule for every
site (plenty of forms submit fine either way), just a thing to try if a submit silently
does nothing.

**Verify:** for cookie solves, seed + reload in the same context (this also verifies
context/IP-bound tokens, since solver and reload share one context — add a proxy so the
CapMonster solver and the browser share an IP if the token is IP-bound). For token/
callback solves, re-read the hidden field's value or watch for the success
state/navigation the page shows once the callback fires. If the captcha reappears, rule
out (1) a wrong token/UA pairing, (2) a solver↔browser IP mismatch, and — for callback
solves — (3) that the callback was invoked in **`world:"main"`** (an isolated-world call
silently no-ops because the callback isn't defined there) before concluding the solve
failed.

## Step 9 — Turn the solve into a standalone script (only if asked)

Mirror the interactive flow in plain code the user owns: load the page with `patchright`
(same stealth engine), do any gating interaction, run the Step-6 `detect()`, call the
CapMonster **REST API directly** to create+poll the task, then run the Step-8
`inject()` and continue.

- Use `page.goto(url, timeout=60000)` and a short `page.wait_for_timeout(2000)` after
  it, since some pages keep the network busy.
- **Talk to the CapMonster REST API directly** with the target env's HTTP client —
  don't reach for a vendor SDK, which can lag the API.
- **A generated script cannot call `mcp__capmonster__*` or the patchright MCP tools** —
  those exist only in this session. The script uses its own `patchright`/`playwright` +
  HTTP client. Note the `world:"main"` MCP option has no direct script equivalent: in a
  script, **vanilla `playwright`'s `page.evaluate` already runs in the main world**, so a
  page-registered callback is callable directly; if the script uses the `patchright`
  engine, pass its main-world flag (`page.evaluate(fn, arg, isolatedContext=false)`) for
  the callback injection, mirroring what `world:"main"` did in-session.
- Ask the user how they want to supply the API key (env var vs. a placeholder) — don't
  embed a real key.

### Run scripts in the FOREGROUND with visible progress — never a silent long run

When you execute a script or test *for the user* (as opposed to shipping code they'll
run themselves), the user is watching a terminal and must be able to tell "it's working"
from "it hung." A single long-running command that prints nothing for minutes is **not
OK** — the user can't distinguish progress from a freeze, and can't tell how much longer.

- **Run in the foreground, streaming output** — not detached/background where the user
  waits blind. The user should see each step as it happens.
- **Emit progress the whole way**: print before each network wait, print which
  proxy/attempt you're on and how many remain (`Proxy 3/10 …`), print the taskId and
  each poll. Every line is a "still alive" signal.
- **Bound the wall-clock and say so up front.** Wrap runs in a timeout so nothing can
  hang the session, and *tell the user the expected duration before you start*
  ("testing 10 proxies, ~30s each, up to ~5 min — you'll see a line per proxy").
- **Don't silently iterate a long list.** Curl-test first (see Step 1's proxy-testing
  rule), shortlist, tell the user the plan, then run the short list with per-item output.
- If something genuinely must run long, **narrate before launching** what will happen and
  what the user will see — never leave them staring at a stalled prompt.

## Things to avoid

- Don't reorder the steps or skip the Step-5 docs gate — no extraction code before docs.
- Don't expect capmonster to load a page — it has no browser. All page work is patchright.
- Don't hardcode a task type or its fields from memory/a previous session — reconfirm
  via `get_supported_tasks` / `get_task_parameters` / `get_docs` every time.
- Don't give up on an interaction-gated or edge-blocked page after one navigate.
- Don't mix params from different page states — re-extract after any navigation.
- Don't round-trip a large blob (`htmlPageBase64`, full-page HTML, a `ComplexImageTask`
  with several images, or any other field/combined payload too big for a normal tool
  response) through your own context via MCP tool calls — use `browser_save_blob` +
  `create_task(task_file=...)`, or a script, to move it file-to-file instead (see Step 6).
  This isn't a transport or server limit — it's you hand-typing a long base64 literal
  into a tool-call argument, which risks a silently dropped/unclosed quote merging
  several array elements into one (confirmed live: a 9-image `bls_3x3` task became
  "Image count: 1" this way, then solved fine when sent file-to-file with the identical
  payload — see `DEV_RESPONSE.md`).
- Don't call `mcp__capmonster__*` or patchright tools from a generated script.
- Don't call `browser_start` with a new `proxy` (or `userAgent`/`locale`/`channel`/other
  launch-only option) expecting it to take effect on an already-running session — the OS
  browser process was already launched with the old values on its command line (e.g.
  `--proxy-server`), and a second `start()` call cannot retroactively change that. This
  now raises an explicit error naming the conflicting option, rather than silently
  keeping the old value (confirmed live pre-fix: the exit IP stayed unchanged after
  passing a new proxy). `browser_close` first, then `browser_start` with the new option.
- Don't build on a user-supplied proxy before curl-testing it (reachability, target
  cert, latency) — a MITM/dead/slow proxy wastes solves and time.
- Don't run a long test silently in the background — foreground it, stream progress,
  bound it with a timeout, and tell the user the expected duration first.
