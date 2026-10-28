import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Access } from 'payload'
import { Affiliates } from './Affiliates.js'

type AccessArgs = Parameters<Access>[0]

function updateAccess(user: { id: number; role: string } | null, id: number | string): ReturnType<Access> {
  const update = Affiliates.access?.update
  assert.ok(update, 'affiliates must define update access')
  const req = { user, headers: new Headers(), payload: {} }
  return update({ req, id } as unknown as AccessArgs)
}

test('a student cannot update the affiliate record whose id equals their user id', async () => {
  assert.equal(await updateAccess({ id: 42, role: 'student' }, 42), false)
  assert.equal(await updateAccess({ id: 42, role: 'student' }, '42'), false)
})

test('a student or instructor cannot update any affiliate record', async () => {
  assert.equal(await updateAccess({ id: 7, role: 'student' }, 99), false)
  assert.equal(await updateAccess({ id: 7, role: 'instructor' }, 7), false)
})

test('no session and no bearer token: no update', async () => {
  assert.equal(await updateAccess(null, 1), false)
})

test('an admin can update affiliate records', async () => {
  assert.equal(await updateAccess({ id: 1, role: 'admin' }, 42), true)
})
