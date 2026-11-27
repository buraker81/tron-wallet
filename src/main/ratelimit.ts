/**
 * Per-host request queue with retry on rate limiting.
 *
 * Public TronGrid without an API key allows about 300 "credits"/s (~3 requests/s) and, when exceeded,
 * answers 429 (sometimes 403) and suspends the caller for a few seconds:
 *   "request credit rate exceeded the allowed_credit(300 credits/s), and the query server is suspended for 5 s"
 * Firing many requests in parallel therefore fails almost entirely. Every request to a host goes through its
 * queue (concurrency + minimum spacing); on 429/403/503 the whole host queue pauses for the suspension time
 * and the request is retried.
 */

export interface Policy {
  concurrency: number
  minIntervalMs: number
}

const RETRY_STATUS = new Set([429, 403, 503])
const MAX_RETRIES = 4

class HostQueue {
  active = 0
  last = 0
  pausedUntil = 0
  waiting: (() => void)[] = []
  timer?: NodeJS.Timeout
  constructor(public policy: Policy) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve)
      this.pump()
    })
  }

  release(): void {
    this.active--
    this.pump()
  }

  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
  }

  private pump(): void {
    if (this.timer) return
    while (this.waiting.length && this.active < this.policy.concurrency) {
      const wait = Math.max(this.pausedUntil, this.last + this.policy.minIntervalMs) - Date.now()
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined
          this.pump()
        }, wait)
        return
      }
      this.active++
      this.last = Date.now()
      this.waiting.shift()!()
    }
  }
}

const queues = new Map<string, HostQueue>()

function queueFor(key: string, policy: Policy): HostQueue {
  let q = queues.get(key)
  if (!q) queues.set(key, (q = new HostQueue(policy)))
  else q.policy = policy
  return q
}

/** Status + message from an axios error or a fetch Response-like error. */
function rateLimitInfo(err: any): { status: number; message: string } | undefined {
  const status = err?.response?.status ?? err?.status
  if (!RETRY_STATUS.has(status)) return undefined
  const data = err?.response?.data
  const message = typeof data === 'string' ? data : (data?.Error ?? data?.error ?? JSON.stringify(data ?? ''))
  return { status, message: String(message) }
}

/** Seconds the server says we are suspended for, or a default backoff. */
function suspension(message: string, attempt: number): number {
  const m = /suspended for (\d+)\s*s/i.exec(message)
  return (m ? Number(m[1]) * 1000 + 300 : 1000 * 2 ** attempt) + Math.random() * 200
}

export class RateLimitError extends Error {}

/** Run `fn` through the host queue, retrying when the host rate limits us. */
export async function throttled<T>(key: string, policy: Policy, fn: () => Promise<T>): Promise<T> {
  const q = queueFor(key, policy)
  for (let attempt = 0; ; attempt++) {
    await q.acquire()
    try {
      return await fn()
    } catch (err) {
      const rl = rateLimitInfo(err)
      if (!rl) throw err
      if (attempt >= MAX_RETRIES) {
        throw new RateLimitError(
          `Rate limited by ${key} (HTTP ${rl.status}). Add an API key for this node (nodes) or wait a moment.`
        )
      }
      q.pause(suspension(rl.message, attempt))
    } finally {
      q.release()
    }
  }
}

/** Throws like axios on rate-limit statuses so fetch callers can share `throttled`. */
export async function checkedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (RETRY_STATUS.has(res.status)) {
    const text = await res.text().catch(() => '')
    let data: any = text
    try {
      data = JSON.parse(text)
    } catch {
      /* keep text */
    }
    throw Object.assign(new Error(`HTTP ${res.status}`), { response: { status: res.status, data } })
  }
  return res
}
