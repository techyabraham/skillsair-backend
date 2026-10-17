# WhatsApp message templates

SkillsAir sends WhatsApp messages through the **Meta WhatsApp Cloud API** (`src/lib/whatsapp.ts`). Nothing is sent unless `WHATSAPP_ENABLED=true`, so development and tests never message real people.

The owner submits these templates in **WhatsApp Manager → Message templates**. Template names, languages, button order and quick-reply payloads must match exactly, because the backend refers to them by name and button index.

## Submission rules

- Language: `en` (English).
- Body variables are numbered `{{1}}`, `{{2}}`, … and must not be the very first or very last thing in the body.
- Every variable needs a sample value when you submit.
- Quick-reply button text: 20 characters or fewer. URL button text: 25 characters or fewer, with at most one variable, at the end of the URL.
- Marketing templates carry the footer `Reply STOP to opt out`.
- Meta makes the final category decision. If it reclassifies a utility template as marketing, the template still works (the person asked for it in Apply step 2); only the cost changes. **Record any reclassification in the phase report.**
- Quick-reply payloads used by the webhook: `HOW_IT_WORKS`, `REQUIREMENTS`, `TALK`. Replying `STOP`, `UNSUBSCRIBE` or `STOP ALL` opts the person out immediately; `START` opts them back in.

## Status in the code

| Template | Category | Trigger | Phase |
|---|---|---|---|
| `skillsair_offer_ready` | Utility | Lead created (Apply step 2) | Built |
| `skillsair_curriculum` | Utility | "Want this curriculum on WhatsApp?" on a programme page | Built |
| `skillsair_payment_help` | Utility | Paystack charge failed or still pending after 2 hours | Built |
| `skillsair_welcome` | Utility | Payment success | Built |
| `skillsair_course_complete` | Utility | Learner completes a programme | Built |
| `skillsair_offer_reminder` | Marketing | 24 hours after the offer, no account, consent | Built |
| `skillsair_window_closing` | Marketing | 48 hours before the window closes, consent | Built |
| `skillsair_window_open` | Marketing | A new window opens, waitlist + consent | Built |

Submit all eight before switching on `WHATSAPP_ENABLED`. Until a template is approved, sends of it fail harmlessly and are recorded in the lead's WhatsApp log.

## 0. `skillsair_curriculum` (Utility)

Sent when someone asks for a programme's curriculum on WhatsApp from the programme page. They asked for it, so it is utility; Meta decides the final category.

**Body:**

```
Hi {{1}}, this is Imisi from SkillsAir 👋

Here's the curriculum you asked for: {{2}}. It shows every module, the free preview lesson and what you'll need to start.

Tap "View the curriculum" to see it, or ask me anything here.
```

**Buttons (in this order):**

| Index | Type | Text | Value |
|---|---|---|---|
| 0 | URL (dynamic) | `View the curriculum` | `https://skillsair.com/programmes/{{1}}` |
| 1 | Quick reply | `How does it work?` | payload `HOW_IT_WORKS` |
| 2 | Quick reply | `Talk to Imisi` | payload `TALK` |

**Samples:** `{{1}}` Tobi · `{{2}}` Data Analysis · URL `{{1}}` `data-analysis`

---

## 1. `skillsair_offer_ready` (Utility)

**Header (text):** `Your SkillsAir application ✅`

**Body:**

```
Hi {{1}}, this is Imisi from SkillsAir 👋

We've received your application for {{2}}, and your personal offer is ready. It shows your Access Scholarship price, everything that's included and what you'll need to start.

Your offer is valid until {{3}}. Tap "View my offer" to see it, or tap a button if you have a question first.
```

**Buttons (in this order):**

| Index | Type | Text | Value |
|---|---|---|---|
| 0 | URL (dynamic) | `View my offer` | `https://skillsair.com/r/{{1}}` |
| 1 | Quick reply | `How does it work?` | payload `HOW_IT_WORKS` |
| 2 | Quick reply | `What do I need?` | payload `REQUIREMENTS` |
| 3 | Quick reply | `Talk to Imisi` | payload `TALK` |

**Samples:** `{{1}}` Tobi · `{{2}}` Data Analysis · `{{3}}` Friday 31 October · URL `{{1}}` `k7Pq2xZa9m`

> When no scholarship window is open, the backend fills `{{3}}` with "the next scholarship window".

## 2. `skillsair_offer_reminder` (Marketing)

**Body:**

```
Hi {{1}}, it's Imisi from SkillsAir.

Your Access Scholarship seat for {{2}} is still waiting for you. You start for just ₦2,000 a month, learn at your own pace (it's designed to take about 3 months). When you're done, your verifiable certificate is ₦10,000.

Not sure yet? Watch a free lesson first. The scholarship price closes on {{3}}, so don't leave it too late.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `See my offer` → `https://skillsair.com/r/{{1}}` · Quick reply `Talk to Imisi` (payload `TALK`)

**Samples:** Tobi · Data Analysis · Friday 31 October · URL `k7Pq2xZa9m`

## 3. `skillsair_window_closing` (Marketing)

**Header (text):** `Scholarship closing soon ⏳`

**Body:**

```
Hi {{1}}, a quick heads-up from Imisi at SkillsAir.

The Access Scholarship closes on {{2}}. After that, {{3}} goes back to the standard fee (₦40,000 a month, or ₦100,000 once) until the next window opens.

Today you can still start for ₦2,000 a month (plus ₦10,000 for your certificate when you finish). If you've been waiting for the right time, this is it.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `Secure my seat` → `https://skillsair.com/r/{{1}}` · Quick reply `Talk to Imisi` (payload `TALK`)

**Samples:** Tobi · Friday 31 October · Data Analysis · URL `k7Pq2xZa9m`

## 4. `skillsair_window_open` (Marketing)

**Body:**

```
Hi {{1}}, good news from SkillsAir 🎉

You asked us to tell you when the Access Scholarship reopened. It's open now: start {{2}} for ₦2,000 a month instead of ₦40,000 a month, learn at your own pace (it's designed to take about 3 months). Your certificate is ₦10,000 when you're done.

This window closes on {{3}}, so grab your seat while it's open.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `See my offer` → `https://skillsair.com/r/{{1}}` · Quick reply `Talk to Imisi` (payload `TALK`)

**Samples:** Tobi · Data Analysis · Saturday 31 January · URL `k7Pq2xZa9m`

## 5. `skillsair_payment_help` (Utility)

**Body:**

```
Hi {{1}}, your SkillsAir payment for {{2}} didn't go through.

If money left your account, don't worry. Banks normally reverse failed payments automatically. If yours hasn't, reply here with your payment reference {{3}} and we'll resolve it within 24 hours.

You can also try again with the button below.
```

**Buttons:** URL `Try again` → `https://skillsair.com/checkout?course={{1}}` · Quick reply `Talk to Imisi` (payload `TALK`)

**Samples:** Tobi · Data Analysis · SAS-course-42-1760000000000 · URL `data-analysis`

## 6. `skillsair_welcome` (Utility)

**Body:**

```
Welcome to SkillsAir, {{1}}! 🎉 Your seat in {{2}} is confirmed.

Three things to do first:
1. Watch your first lesson today
2. Aim for about 8 hours a week
3. Finish by {{3}}

Your free CV & LinkedIn and Freelancing courses are waiting in your dashboard. Questions? Reply here, Monday to Saturday, 9am–6pm.
```

**Buttons:** URL (static) `Start learning` → `https://skillsair.com/dashboard`

**Samples:** Tobi · Data Analysis · Tuesday 20 January

## 7. `skillsair_course_complete` (Utility)

**Body:**

```
Congratulations, {{1}}! 🎓 You've completed {{2}}.

Your verifiable certificate is ready to claim for ₦10,000. It gives you a link employers can check, access to internship openings from our partner firms, and the right to apply for this cohort's laptop support.

Tap below to claim it whenever you're ready.
```

**Buttons:** URL `Claim my certificate` → `https://skillsair.com/checkout?certificate={{1}}`

**Samples:** Tobi · Data Analysis · URL `data-analysis`

---

## Lifecycle templates (8–13)

Submit these with the lifecycle email release (approval can take a few days). They all use **one URL button with a variable path**: `https://skillsair.com/{{1}}`. The backend fills the path (for example `billing/update-card?subscription=9` or `checkout?course=data-analysis`), so one approved template works for every programme. Marketing templates carry the footer **Reply STOP to opt out**. If Meta reclassifies a utility template as marketing, note it here: the engine then only sends it to people with marketing consent.

The engine sends each one at most once per event (logged in the `messages` collection). Until a template is approved, sends fail quietly and are logged as skipped.

## 8. `skillsair_payment_failed` (Utility) · D1

Sent with email D1 on the first failed renewal. Paystack doesn't retry a failed renewal, so the button takes the learner to pay this month's ₦2,000 (at their locked rate).

**Body:**

```
Hi {{1}}, your ₦2,000 monthly renewal for {{2}} didn't go through today.

You keep access for {{3}} more days. Pay this month's ₦2,000 with the button below (same card or a different one) and you won't lose a day.
```

**Buttons:** URL `Pay ₦2,000` → `https://skillsair.com/{{1}}` · Quick reply `Talk to Imisi`

**Samples:** Tobi · Data Analysis · 3 · URL `billing/update-card?subscription=9`

## 9. `skillsair_access_paused` (Utility) · T6

**Body:**

```
Hi {{1}}, your {{2}} access is paused because your plan has ended.

Your progress is saved ({{3}}% done). Restart anytime at your locked rate of ₦2,000 a month. The certificate is ₦10,000 when you finish.
```

**Buttons:** URL `Restart` → `https://skillsair.com/{{1}}` · Quick reply `Talk to Imisi`

**Samples:** Tobi · Data Analysis · 45 · URL `checkout?course=data-analysis`

## 10. `skillsair_learning_nudge` (Marketing, expected) · I2

Only if email I2 wasn't opened within 24 hours, and only with marketing consent.

**Body:**

```
Hi {{1}}, it's Imisi from SkillsAir. You haven't been back to {{2}} for a while.

Your next lesson is ready: "{{3}}". Can you give it 20 minutes today?
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `Continue` → `https://skillsair.com/{{1}}` · Quick reply `I'm stuck` (puts the learner in Imisi's queue)

**Samples:** Tobi · Data Analysis · Cleaning messy data · URL `dashboard/courses/data-analysis/learn`

## 11. `skillsair_resume_offer` (Marketing) · R2

**Body:**

```
Hi {{1}}, it's Imisi. Your {{2}} progress is still saved ({{3}}% done).

Your rate is locked at ₦2,000 a month, even though new learners pay more. Restart whenever you're ready. Certificate: ₦10,000 when you finish.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `Restart` → `https://skillsair.com/{{1}}` · Quick reply `Talk to Imisi`

**Samples:** Tobi · Data Analysis · 45 · URL `checkout?course=data-analysis`

## 12. `skillsair_certificate_reminder` (Marketing) · C2

**Body:**

```
Hi {{1}}, congratulations again on finishing {{2}} 🎓

Your certificate is ready to claim for ₦10,000. It's your key to internship openings from our partner firms and to laptop support applications.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `Claim my certificate` → `https://skillsair.com/{{1}}`

**Samples:** Tobi · Data Analysis · URL `checkout?certificate=data-analysis`

## 13. `skillsair_next_programme` (Marketing) · G2

The owner's rule: the ₦2,000-a-month rate carries over to a new programme only within 3 days of finishing (that offer is in the completion email), so this template quotes no price.

**Body:**

```
Hi {{1}}, congratulations again on your {{2}} certificate.

{{3}} pairs well with it, and two certificates make a much stronger CV than one. See what it covers and what it costs today.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `See next programme` → `https://skillsair.com/{{1}}`

**Samples:** Tobi · Data Analysis · Product Management · URL `programmes/product-management`

---

## Free-form replies

Free-form replies are only allowed inside the 24-hour customer-service window that opens when the person messages or taps a button. Their copy lives in `src/content/whatsapp-replies.ts`. Every message speaks as Imisi; an AI assistant (phase 3) must introduce itself as "SkillsAir's assistant", never as Imisi.

## Connecting the webhook

1. In the Meta app dashboard → WhatsApp → Configuration, set the callback URL to `https://kiwi.skillsair.com/api/whatsapp/webhook` and the verify token to the value of `WHATSAPP_VERIFY_TOKEN`.
2. Subscribe to the `messages` field.
3. Set `WHATSAPP_APP_SECRET` to the app secret so the backend can verify `X-Hub-Signature-256`. Requests with a missing or wrong signature are rejected with 401.
4. Check whether the number can use **WhatsApp Business app coexistence** (one number on both the Cloud API and the Business app). If it can, Imisi replies from the app as normal; if not, phase 2 adds a reply box to the lead view in the admin.
