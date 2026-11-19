import { describe, expect, test } from "bun:test";
import { SynthJobQueue } from "./synthJobQueue";

type Job = { id: string; epoch?: number };

describe("SynthJobQueue", () => {
	test("runs jobs in order and drops older epochs once a newer one arrives", async () => {
		const log: string[] = [];
		let done!: () => void;
		const finished = new Promise<void>((r) => (done = r));
		const q: SynthJobQueue<Job> = new SynthJobQueue<Job>(async (job) => {
			if (q.isStale(job)) {
				log.push(`${job.id}:cancelled`);
			} else {
				// A seek lands while this job is "running" (between two pieces).
				if (job.id === "a") q.push({ id: "c", epoch: 2 });
				const stale = await q.yieldAndCheckStale(job);
				log.push(`${job.id}:${stale ? "cancelled" : "ran"}`);
			}
			if (job.id === "c") done();
		});
		q.push({ id: "a", epoch: 1 });
		q.push({ id: "export" }); // no epoch: never stale
		q.push({ id: "b", epoch: 1 });
		await finished;
		expect(log).toEqual(["a:cancelled", "export:ran", "b:cancelled", "c:ran"]);
	});
});
