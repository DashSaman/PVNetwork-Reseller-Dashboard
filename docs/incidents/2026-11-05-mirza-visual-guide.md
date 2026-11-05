# Illustrated reseller setup guide — 2026-11-05

The Mirza sales card now contains the complete illustrated tutorial, available
even before sales access is enabled. The public `/guide/mirza-bot` page uses the
same component. Ten short steps have numbered navigation, previous/next/restart,
sample UI illustrations, marked controls and expected outcomes. Troubleshooting
is available within the guide. Illustrations use synthetic values and never
receive a real API key or account data.

## Verified installed setup flow

The previous guide described fields correctly at the API level but did not fully
describe Mirza 0.8.1's Telegram administrator conversation. Installed source was
read without sending messages or changing settings:

- `admin.php` SHA-256
  `19ad66f3184d5ebeb0443369d86c7349fee35437f94e06e045bf9834bc322343`.
- Persian labels SHA-256
  `28d862fa789f03dcebed85e5975927c874bbc1dab872129da80c6277e40481dd`.
- Add-panel flow: “اضافه کردن پنل” → “3x-ui” → display name → own bridge URL →
  sales API token. This type does not ask for a dashboard username/password pair.
- “تنظیم پروتکل و اینباند” reads the internal username of an owned sample client
  and copies its memberships. The sample must have only the desired, currently
  permitted online locations. It does not change native protocols or routing.
- “دامنه لینک ساب” asks for a **complete working customer subscription URL**.
  The installed handler fetches that URL, checks the configurations and stores
  `dirname(url)` as `linksubx`. Sending `/api/s` alone to this prompt fails;
  `/api/s` is the stored base, not the complete sample link the bot requests.
- Trial volume is requested in MB: **1024 MB = 1 GB**. The guide explains whole-GB
  plans and explicitly identifies allocation from the reseller pool when a real
  sample account is created. Prices and plans are left to the reseller.

## Verification before release

The isolated Mirza fixture passed **57/57** checks: 42 API/public-render checks and
15 browser checks. The browser walked all ten inline steps, restart and boundaries,
the public guide, all steps at 320px and 390px widths, one-time sales-key controls
and desktop/dark/mobile rendering. Tutorial navigation made no API requests and
did not change the stored integration key or native customer records.

Desktop location-selection and mobile subscription illustrations were visually
inspected. Fresh TypeScript and targeted ESLint checks exited 0. The backend,
schema and dependencies are unchanged. Screenshots and private source evidence
are retained under ignored local evidence directories, never in public docs.

## Release record

Production image and read-only acceptance are recorded here after deployment.
Do not replay prior integration provisioning or rotate an existing bot key to
test a presentation-only guide update.
