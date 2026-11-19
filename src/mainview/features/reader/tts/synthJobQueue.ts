/**
 * Serial, epoch-aware job queue shared by both synthesis workers (renderer
 * WebGPU/WASM worker and the native onnxruntime-node process).
 *
 * The renderer bumps an epoch on every seek / voice / speed change and stamps
 * playback requests with it. Once a job with a newer epoch has arrived, every
 * older-epoch job is stale: it is answered with {@link CANCELLED} instead of
 * occupying the engine while the chunk the listener actually wants waits
 * behind it. Jobs without an epoch (audiobook export) are never stale.
 *
 * Why an epoch rather than a cancel message: inference blocks the worker's
 * event loop (onnxruntime-node runs synchronously), so a separate cancel can
 * be read only after the next stale run already started. Jobs yield to the
 * event loop between steps so newer messages are read in time.
 */
export const CANCELLED = "cancelled";

export type EpochJob = { epoch?: number };

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

export class SynthJobQueue<J extends EpochJob> {
	private readonly jobs: J[] = [];
	private latestEpoch = 0;
	private draining = false;

	/** `run` must handle its own errors; it is called once per job, in order. */
	constructor(
		private readonly run: (job: J) => Promise<void>,
		private readonly yieldToEvents: () => Promise<void> = defaultYield,
	) {}

	push(job: J): void {
		if (job.epoch !== undefined && job.epoch > this.latestEpoch) {
			this.latestEpoch = job.epoch;
		}
		this.jobs.push(job);
		void this.drain();
	}

	isStale(job: J): boolean {
		return job.epoch !== undefined && job.epoch < this.latestEpoch;
	}

	/** Let queued messages in, then report whether `job` went stale meanwhile. */
	async yieldAndCheckStale(job: J): Promise<boolean> {
		await this.yieldToEvents();
		return this.isStale(job);
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.jobs.length > 0) {
				await this.yieldToEvents();
				const job = this.jobs.shift()!;
				try {
					await this.run(job);
				} catch {
					// run reports its own errors; keep draining regardless.
				}
			}
		} finally {
			this.draining = false;
		}
	}
}
