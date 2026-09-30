import { ConcurrencyLimiter } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/uploadConcurrencyLimiter";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("ConcurrencyLimiter", () => {
  it("rejects a max below 1", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow(/at least 1/);
  });

  it("never lets more than max holders run, and hands a freed slot to the next waiter", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const task = async () => {
      const release = await limiter.acquire();
      running++;
      peak = Math.max(peak, running);
      releases.push(() => {
        running--;
        release();
      });
    };

    const tasks = [task(), task(), task(), task()];
    await flush();
    expect(running).toBe(2);
    expect(limiter.inFlight).toBe(2);

    releases.shift()?.();
    await flush();
    expect(running).toBe(2);

    while (releases.length) {
      releases.shift()?.();
      await flush();
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(limiter.inFlight).toBe(0);
  });

  it("ignores a second call to the same release", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const release = await limiter.acquire();
    release();
    release();
    expect(limiter.inFlight).toBe(0);
    const again = await limiter.acquire();
    expect(limiter.inFlight).toBe(1);
    again();
  });
});
