import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { describeWithDb, execute, getTestPayload, truncate } from '../../test/payload-harness.js'
import { AMBASSADOR_SETTINGS_DEFAULTS, clearAmbassadorSettingsCache, getAmbassadorSettings, withAmbassadorDefaults } from './settings.js'

const SETTINGS_TABLES = ['ambassador_settings', 'ambassador_settings_commissionable_types', 'ambassador_settings_heard_about_options']

describe('withAmbassadorDefaults', () => {
  it('returns every default for an empty document', () => {
    expect(withAmbassadorDefaults({})).toEqual(AMBASSADOR_SETTINGS_DEFAULTS)
    expect(withAmbassadorDefaults(null)).toEqual(AMBASSADOR_SETTINGS_DEFAULTS)
  })

  it('matches the brief', () => {
    expect(AMBASSADOR_SETTINGS_DEFAULTS).toMatchObject({
      programOpen: true,
      defaultApplicationStatus: 'pending',
      commissionRateBps: 5000,
      commissionableTypes: ['course', 'subscription', 'renewal'],
      approvalDelayDays: 7,
      cookieDays: 30,
      attributionModel: 'first_click',
      attributionLifetimeDays: null,
      minPayoutKobo: 500_000,
      payoutsEnabled: true,
      payoutMode: 'manual_review',
      perTransferCapKobo: 20_000_000,
      dailyCapKobo: 100_000_000,
      newBankHoldHours: 48,
      showReferredEmails: true,
    })
  })

  it('keeps set values, including false and 0, and replaces invalid ones', () => {
    const settings = withAmbassadorDefaults({
      programOpen: false,
      commissionRateBps: 0,
      approvalDelayDays: 99, // out of range
      cookieDays: '14',
      attributionLifetimeDays: 90,
      commissionableTypes: ['course', 'nonsense'],
      heardAboutOptions: [{ option: 'Radio' }, { option: '' }],
      shareMessage: '   ',
    })
    expect(settings.programOpen).toBe(false)
    expect(settings.commissionRateBps).toBe(0)
    expect(settings.approvalDelayDays).toBe(7)
    expect(settings.cookieDays).toBe(14)
    expect(settings.attributionLifetimeDays).toBe(90)
    expect(settings.commissionableTypes).toEqual(['course'])
    expect(settings.heardAboutOptions).toEqual(['Radio'])
    expect(settings.shareMessage).toBe(AMBASSADOR_SETTINGS_DEFAULTS.shareMessage)
  })
})

describeWithDb('getAmbassadorSettings', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getTestPayload()
  })

  beforeEach(async () => {
    await truncate(payload, SETTINGS_TABLES)
    clearAmbassadorSettingsCache()
  })

  it('applies every default when the global has never been saved', async () => {
    expect(await getAmbassadorSettings(payload)).toEqual(AMBASSADOR_SETTINGS_DEFAULTS)
  })

  it('reads a saved value; the save clears the cache', async () => {
    expect((await getAmbassadorSettings(payload)).commissionRateBps).toBe(5000)
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { commissionRateBps: 4000 }, overrideAccess: true })
    const settings = await getAmbassadorSettings(payload)
    expect(settings.commissionRateBps).toBe(4000)
    expect(settings.cookieDays).toBe(30)
  })

  it('serves the cached value until the cache is cleared', async () => {
    await getAmbassadorSettings(payload)
    await payload.updateGlobal({ slug: 'ambassador-settings', data: { cookieDays: 10 }, overrideAccess: true })
    await getAmbassadorSettings(payload)
    // A change that skips Payload (and its hook) is not seen until the cache is cleared.
    await execute(payload, sql`UPDATE "ambassador_settings" SET "cookie_days" = 20`)
    expect((await getAmbassadorSettings(payload)).cookieDays).toBe(10)
    clearAmbassadorSettingsCache()
    expect((await getAmbassadorSettings(payload)).cookieDays).toBe(20)
  })
})
