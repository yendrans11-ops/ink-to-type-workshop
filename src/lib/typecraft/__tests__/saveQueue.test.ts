import { afterEach, expect, it, vi } from "vitest";
import { createSaveQueue } from "../saveQueue";
afterEach(() => vi.useRealTimers());
it("does not write a scheduled account A edit under account B", async () => {
  vi.useFakeTimers(); let owner = "A";
  const write = vi.fn(async () => {});
  const q = createSaveQueue(write, () => owner);
  q.schedule({ project: "old" }, "A", () => {});
  owner = "B";
  await vi.advanceTimersByTimeAsync(1200);
  expect(write).not.toHaveBeenCalled();
});
it("saves the snapshot that scheduled it, not the subsequently opened project", async () => {
  vi.useFakeTimers(); const write = vi.fn(async () => {});
  const q = createSaveQueue(write, () => "A");
  q.schedule({ project: "edited" }, "A", () => {});
  await vi.advanceTimersByTimeAsync(1200);
  expect(write).toHaveBeenCalledWith({ project: "edited" }, "A");
});
it("serializes saves so an older request cannot finish after a newer one", async () => {
  const order: number[] = [];
  const q = createSaveQueue(async (n: number) => { await Promise.resolve(); order.push(n); }, () => "A");
  await Promise.all([q.save(1, "A"), q.save(2, "A")]);
  expect(order).toEqual([1, 2]);
});