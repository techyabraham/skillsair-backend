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
| `skillsair_offer_ready` | Utility | Lead created (Apply step 2) | **Live in phase 1** |
| `skillsair_payment_help` | Utility | Paystack charge failed or still pending after 2 hours | Phase 2 |
| `skillsair_welcome` | Utility | Payment success | Phase 2 |
| `skillsair_course_complete` | Utility | Learner completes a programme | Phase 2 |
| `skillsair_offer_reminder` | Marketing | 24 hours after the offer, no account, consent | Phase 2 |
| `skillsair_window_closing` | Marketing | 48 hours before the window closes, consent | Phase 2 |
| `skillsair_window_open` | Marketing | A new window opens, waitlist + consent | Phase 2 |

Submit all seven now so Meta's review finishes before phase 2.

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

Your Access Scholarship seat for {{2}} is still waiting for you. You start for just ₦2,000, learn at your own pace and have 3 months to finish. When you're done, your verifiable certificate is ₦10,000.

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

The Access Scholarship closes on {{2}}. After that, {{3}} goes back to the standard fee of ₦100,000 until the next window opens.

Today you can still start for ₦2,000 (plus ₦10,000 for your certificate when you finish). If you've been waiting for the right time, this is it.
```

**Footer:** `Reply STOP to opt out`

**Buttons:** URL `Secure my seat` → `https://skillsair.com/r/{{1}}` · Quick reply `Talk to Imisi` (payload `TALK`)

**Samples:** Tobi · Friday 31 October · Data Analysis · URL `k7Pq2xZa9m`

## 4. `skillsair_window_open` (Marketing)

**Body:**

```
Hi {{1}}, good news from SkillsAir 🎉

You asked us to tell you when the Access Scholarship reopened. It's open now: start {{2}} for ₦2,000 instead of ₦100,000, learn at your own pace, and take up to 3 months to finish. Your certificate is ₦10,000 when you're done.

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

## Free-form replies

Free-form replies are only allowed inside the 24-hour customer-service window that opens when the person messages or taps a button. Their copy lives in `src/content/whatsapp-replies.ts`. Every message speaks as Imisi; an AI assistant (phase 3) must introduce itself as "SkillsAir's assistant", never as Imisi.

## Connecting the webhook

1. In the Meta app dashboard → WhatsApp → Configuration, set the callback URL to `https://kiwi.skillsair.com/api/whatsapp/webhook` and the verify token to the value of `WHATSAPP_VERIFY_TOKEN`.
2. Subscribe to the `messages` field.
3. Set `WHATSAPP_APP_SECRET` to the app secret so the backend can verify `X-Hub-Signature-256`. Requests with a missing or wrong signature are rejected with 401.
4. Check whether the number can use **WhatsApp Business app coexistence** (one number on both the Cloud API and the Business app). If it can, Imisi replies from the app as normal; if not, phase 2 adds a reply box to the lead view in the admin.
