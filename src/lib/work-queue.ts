/**
 * A small Redis work queue for slow jobs started from Studio (caption re-imports). Tasks wait in
 * a list; the worker takes them one at a time, retries a failed task up to 3 times with growing
 * delays, then moves it to the dead-letter list Studio shows in "Needs attention".
 */
import { randomUUID } from 'node:crypto'
import { redis } from './redis.js'
import { logger } from './logger.js'
import { captureError } from './observability.js'

export type TaskType = 'captions-import' | 'guided-plan-email'

export interface Task {
  id: string
  type: TaskType
  payload: Record<string, unknown>
  attempts: number
  /** Not before this time (ms), for retry backoff. */
  runAfter: number
  enqueuedAt: string
  lastError?: string
}

const QUEUE = 'work-queue:pending'
const DEAD = 'work-queue:dead'
const MAX_ATTEMPTS = 3

export async function enqueue(type: TaskType, payload: Record<string, unknown>): Promise<string> {
  const task: Task = { id: randomUUID(), type, payload, attempts: 0, runAfter: Date.now(), enqueuedAt: new Date().toISOString() }
  await redis.lpush(QUEUE, JSON.stringify(task))
  return task.id
}

export type Handler = (task: Task) => Promise<void>

/** Processes due tasks (oldest first) until `budgetMs` runs out; called by the worker every minute. */
export async function processQueue(handlers: Partial<Record<TaskType, Handler>>, budgetMs = 50_000): Promise<number> {
  const started = Date.now()
  let processed = 0
  const length = await redis.llen(QUEUE)
  for (let i = 0; i < length && Date.now() - started < budgetMs; i++) {
    const raw = await redis.rpop(QUEUE)
    if (!raw) break
    let task: Task
    try {
      task = JSON.parse(raw) as Task
    } catch {
      await redis.lpush(DEAD, raw)
      continue
    }
    if (task.runAfter > Date.now()) {
      await redis.lpush(QUEUE, raw)
      continue
    }
    const handler = handlers[task.type]
    try {
      if (!handler) throw new Error(`No handler for ${task.type}`)
      await handler(task)
      processed++
    } catch (err) {
      task.attempts++
      task.lastError = err instanceof Error ? err.message : String(err)
      logger.warn({ taskId: task.id, type: task.type, attempts: task.attempts, err: task.lastError }, 'work_queue_task_failed')
      if (task.attempts >= MAX_ATTEMPTS) {
        captureError(err, { source: 'work-queue', type: task.type, taskId: task.id })
        await redis.lpush(DEAD, JSON.stringify(task))
      }
      else {
        task.runAfter = Date.now() + 2 ** task.attempts * 60_000
        await redis.lpush(QUEUE, JSON.stringify(task))
      }
    }
  }
  return processed
}

export async function queueStatus(): Promise<{ pending: number; dead: Task[] }> {
  try {
    const [pending, dead] = await Promise.all([redis.llen(QUEUE), redis.lrange(DEAD, 0, 49)])
    return { pending, dead: dead.map((raw) => { try { return JSON.parse(raw) as Task } catch { return null } }).filter((task): task is Task => Boolean(task)) }
  } catch {
    return { pending: 0, dead: [] }
  }
}

/** Puts a dead task back on the queue (Studio "Retry"). */
export async function retryDead(taskId: string): Promise<boolean> {
  const dead = await redis.lrange(DEAD, 0, -1)
  for (const raw of dead) {
    const task = JSON.parse(raw) as Task
    if (task.id !== taskId) continue
    await redis.lrem(DEAD, 1, raw)
    await redis.lpush(QUEUE, JSON.stringify({ ...task, attempts: 0, runAfter: Date.now() }))
    return true
  }
  return false
}
