import { describe, expect, it } from "vitest";
import { createLatest } from "./latest";

describe("createLatest", () => {
  it("keeps only the newest request current", () => {
    const latest = createLatest();
    const first = latest.begin();
    const second = latest.begin();
    expect(latest.isCurrent(first)).toBe(false);
    expect(latest.isCurrent(second)).toBe(true);
  });

  it("drops an older result that finishes after a newer one", async () => {
    const latest = createLatest();
    const applied: string[] = [];
    let finishOld!: () => void;
    const run = async (name: string, done: Promise<void>) => {
      const token = latest.begin();
      await done;
      if (latest.isCurrent(token)) applied.push(name);
    };
    const old = run("old", new Promise((resolve) => (finishOld = resolve)));
    await run("new", Promise.resolve());
    finishOld();
    await old;
    expect(applied).toEqual(["new"]);
  });
});
