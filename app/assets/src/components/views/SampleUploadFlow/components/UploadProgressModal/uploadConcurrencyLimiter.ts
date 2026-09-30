/**
 * ConcurrencyLimiter -- a small async semaphore shared by every ResumableUpload in a batch.
 *
 * Kept in its own module (not resumableUpload.ts) so code and tests that replace ResumableUpload
 * with a mock still get the real limiter.
 */
// Bounds how many part uploads run at once ACROSS every ResumableUpload that shares it (all files of
// all samples in a batch). queueSize alone only bounds one file, so a batch of several samples x
// several files x queueSize parts could put dozens of 5 MiB PUTs on one uplink at once, each too slow
// to finish inside the request timeout.
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) {
      throw new Error("ConcurrencyLimiter: max must be at least 1.");
    }
  }

  // Resolves with a release function once a slot is free. Call release exactly once.
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
    } else {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next(); // hand the slot straight to the next waiter; active count unchanged
      } else {
        this.active--;
      }
    };
  }

  get inFlight(): number {
    return this.active;
  }
}
