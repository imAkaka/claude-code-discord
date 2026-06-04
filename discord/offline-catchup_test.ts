/** @module discord/offline-catchup_test — Pure helpers for offline catch-up. */
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  decodeCatchupCustomId,
  encodeCatchupCustomId,
  formatMergedPrompt,
  pLimit,
} from "./offline-catchup.ts";

Deno.test("formatMergedPrompt: single message", () => {
  const out = formatMergedPrompt([
    { id: "1", content: "hello", createdAt: new Date("2026-05-24T14:32:01Z") },
  ]);
  assertEquals(
    out,
    "[这是你离线期间用户在该 thread/频道累积发送的 1 条消息，按时间顺序排列。请综合判断如何处理：]\n\n" +
      "1. (2026-05-24T14:32:01.000Z) hello",
  );
});

Deno.test("formatMergedPrompt: multiple messages preserve order", () => {
  const out = formatMergedPrompt([
    { id: "1", content: "改一下颜色", createdAt: new Date("2026-05-24T14:32:01Z") },
    { id: "2", content: "再改字体", createdAt: new Date("2026-05-24T14:33:15Z") },
    { id: "3", content: "算了用红色", createdAt: new Date("2026-05-24T14:35:42Z") },
  ]);
  const lines = out.split("\n");
  assertEquals(lines[0].includes("3 条消息"), true);
  assertEquals(lines[2], "1. (2026-05-24T14:32:01.000Z) 改一下颜色");
  assertEquals(lines[3], "2. (2026-05-24T14:33:15.000Z) 再改字体");
  assertEquals(lines[4], "3. (2026-05-24T14:35:42.000Z) 算了用红色");
});

Deno.test("encode/decodeCatchupCustomId round-trip", () => {
  const id = encodeCatchupCustomId("process", "ch1", "msgOld", "msgNew");
  assertEquals(id, "offline-catchup:process:ch1:msgOld:msgNew");
  const decoded = decodeCatchupCustomId(id);
  assertEquals(decoded, {
    action: "process",
    channelId: "ch1",
    oldestId: "msgOld",
    newestId: "msgNew",
  });
});

Deno.test("decodeCatchupCustomId: ignore action allows empty oldestId", () => {
  const id = encodeCatchupCustomId("ignore", "ch1", "", "msgNew");
  assertEquals(id, "offline-catchup:ignore:ch1::msgNew");
  const decoded = decodeCatchupCustomId(id);
  assertEquals(decoded?.action, "ignore");
  assertEquals(decoded?.oldestId, "");
  assertEquals(decoded?.newestId, "msgNew");
});

Deno.test("decodeCatchupCustomId: returns null for non-matching prefix", () => {
  assertEquals(decodeCatchupCustomId("pagination:next:abc"), null);
  assertEquals(decodeCatchupCustomId(""), null);
});

Deno.test("pLimit: caps concurrency", async () => {
  const limit = pLimit(2);
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({ length: 5 }, () =>
    limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return "ok";
    }));
  const results = await Promise.all(tasks);
  assertEquals(results.length, 5);
  assertEquals(maxActive <= 2, true);
});
