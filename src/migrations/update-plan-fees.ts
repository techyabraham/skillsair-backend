/**
 * Moves each active Paystack plan to the price plus the Paystack fee (₦2,000 → ₦2,031), so card
 * subscriptions pass the fee on like transfer and OPay payments do (see paystackFee in billing.ts).
 * Until a plan is updated, card checkout for it stops with "Paystack plan does not match".
 * Existing card subscribers keep the amount they signed up for.
 *
 * Dry run by default; nothing changes at Paystack without --execute. Needs PAYSTACK_SECRET_KEY
 * (the live key in production).
 *
 * Usage:
 *   npm run paystack:plan-fees [-- --execute]
 */
import { loadEnv } from 'payload/node'
import { getPayload } from 'payload'
import { getPlan, updatePlanAmount } from '../lib/paystack.js'
import { withPaystackFee } from '../lib/billing.js'

interface PlanRow {
  id: number
  name: string
  price: number
  paystackPlanCode?: string | null
}

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute')
  await loadEnv()
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY is not set.')
    process.exit(1)
  }
  const { default: config } = await import('../../payload.config.js')
  const payload = await getPayload({ config })
  const result = await payload.find({ collection: 'plans', where: { isActive: { equals: true } }, limit: 1000, depth: 0, overrideAccess: true })

  const rows: string[] = []
  let failed = 0
  for (const plan of result.docs as unknown as PlanRow[]) {
    if (!plan.paystackPlanCode) {
      rows.push(`${plan.name}: no Paystack plan code (skipped)`)
      continue
    }
    const target = withPaystackFee(Number(plan.price))
    try {
      const current = await getPlan(plan.paystackPlanCode)
      const currentNgn = current.amount / 100
      if (currentNgn === target) {
        rows.push(`${plan.name}: already ₦${target} (${plan.paystackPlanCode})`)
        continue
      }
      if (!execute) {
        rows.push(`${plan.name}: would change ₦${currentNgn} → ₦${target} (${plan.paystackPlanCode})`)
        continue
      }
      await updatePlanAmount(plan.paystackPlanCode, target)
      rows.push(`${plan.name}: changed ₦${currentNgn} → ₦${target} (${plan.paystackPlanCode})`)
    } catch (err) {
      failed++
      rows.push(`${plan.name}: FAILED (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  console.log(execute ? 'EXECUTED: Paystack plans updated.' : 'DRY RUN: nothing changed. Re-run with --execute to apply.')
  console.log(`\nActive plans (${rows.length})\n${rows.map((row) => `  - ${row}`).join('\n') || '  (none)'}`)
  if (failed) console.log(`\nFailed: ${failed}`)
  process.exit(failed ? 1 : 0)
}

void run()
