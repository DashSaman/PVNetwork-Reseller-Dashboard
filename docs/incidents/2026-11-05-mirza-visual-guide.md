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

- Accepted runtime commit `b2f1dd420f4924f25075a725078de6abde134299`, image
  `pv-reseller-dashboard:mirza-guide-20261105`, SHA-256
  `8b4080df1eb139d4a7c2cd1a7f45fd08d5f7a2886b9642d3bee6f6dc91fe0809`.
- The exact standalone image passed **207/207** checks: customer API 79, lifecycle
  41, permission/accounting audit 45 and Mirza/public-guide 42. No test host ports,
  external network or production data mounts were used.
- Deployment preserved all real database rows; activity logs were append-only.
  The runtime encryption key, existing binding, environment and data mount were
  preserved.
  Native inbound configuration, other container identities, service PIDs and
  ports matched the baseline. Both scheduled backup/observation timers stayed
  active. Backend, schema and dependencies were independently checked unchanged.
- Headless Chrome then walked **all ten steps five times on the real HTTPS site**:
  public desktop, public 390px and 320px mobile, and the inline guide in each of
  the two active reseller accounts. Zero JavaScript errors, API write attempts
  or visible real sales keys were recorded. Live dark-mode rendering was captured
  after color transitions finished and visually inspected.
- Final read-only acceptance again read **66/66** current customers. Existing
  sales-key hashes matched the pre-deployment snapshot exactly. The release did
  not enable sales, rotate keys, change prices/plans, modify a real customer or
  change the pilot bot's configuration.
- The original 1.35 GiB build guard was retained. Only specifically identified
  stopped obsolete dashboard artifacts and unreferenced stages proven by the
  dashboard's own historical build log were retired for headroom. Running and
  immediate working rollback images, shared bases and other services were
  preserved. This release's own completed build stages were cleaned afterward.
- Final archive `pvnet-20261105T160714Z-a97a9f0df04e.zip`, 93,869 bytes, SHA-256
  `398feaa441a92bff6f7064b20f3ff832f41dc973461ec43ab82eb30187fe8214`.
  All eight dashboard tables and the recovery key were verified: 66 customers,
  3 owner records, 33 grants, 65 settings and 166 journals; native panel exports 0.

Private receipts are under the `mirza-guide-20261105` release directory and the
ignored local guide evidence directory. Do not replay prior integration
provisioning or rotate an existing bot key to test a presentation-only update.
