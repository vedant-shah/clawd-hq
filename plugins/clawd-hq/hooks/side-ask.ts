// One background question to the model at a time, for the whole plugin: the check on finished work waits its turn in a
// short line, and the recap, which can always be made later, is skipped while anything runs or waits.
/** How many questions may wait; one more pushes out the oldest waiting. */
export const SIDE_WAITING = 3

type Task = { run: () => Promise<unknown>; onDrop?: () => void }

/** Starts `run` now; whatever it throws or rejects with is let go. */
function attempt(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return Promise.resolve(run()).catch(() => undefined)
  } catch {
    return Promise.resolve()
  }
}

export function sideLine() {
  let isRunning = false
  let waiting: readonly Task[] = []

  const start = (task: Task) => {
    isRunning = true
    // A task that throws, at once or later, is let go: the line goes on.
    void attempt(task.run).finally(() => {
      isRunning = false
      const [next, ...rest] = waiting
      waiting = rest
      if (next) start(next)
    })
  }

  return {
    isBusy: () => isRunning || waiting.length > 0,
    /** Runs `run` now if the line is free, else after those ahead of it; `onDrop` hears if it is pushed out unrun. */
    queue(run: () => Promise<unknown>, onDrop?: () => void) {
      if (!isRunning && waiting.length === 0) return start({ run, onDrop })
      const all = [...waiting, { run, onDrop }]
      waiting = all.slice(-SIDE_WAITING)
      for (const gone of all.slice(0, all.length - waiting.length)) gone.onDrop?.()
    },
    /** Runs `run` now only if nothing runs or waits; says whether it did. */
    tryNow(run: () => Promise<unknown>): boolean {
      if (isRunning || waiting.length > 0) return false
      start({ run })
      return true
    },
    /** Drops what waits, each one told; the one running finishes. */
    clear() {
      const gone = waiting
      waiting = []
      for (const one of gone) one.onDrop?.()
    },
  }
}

/** The plugin's one line. */
export const side = sideLine()
