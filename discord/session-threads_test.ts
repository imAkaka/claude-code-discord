/** @module discord/session-threads_test — Persistence + bookmark tests. */
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";
import { SessionThreadManager } from "./session-threads.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "session-threads-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("recordActivity stores lastSeenMessageId when provided", async () => {
  await withTempDir(async (dir) => {
    const mgr = new SessionThreadManager(dir);
    const file = path.join(dir, "session-threads.json");
    await Deno.writeTextFile(
      file,
      JSON.stringify([{
        sessionId: "s1",
        threadId: "t1",
        threadName: "test",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        messageCount: 0,
      }]),
    );
    await mgr.loadFromDisk();

    mgr.recordActivity("s1", "msg-123");

    await new Promise((r) => setTimeout(r, 1100));

    const raw = await Deno.readTextFile(file);
    const records = JSON.parse(raw);
    assertEquals(records[0].lastSeenMessageId, "msg-123");
    assertEquals(records[0].messageCount, 1);
  });
});

Deno.test("recordActivity without messageId leaves bookmark untouched", async () => {
  await withTempDir(async (dir) => {
    const mgr = new SessionThreadManager(dir);
    const file = path.join(dir, "session-threads.json");
    await Deno.writeTextFile(
      file,
      JSON.stringify([{
        sessionId: "s1",
        threadId: "t1",
        threadName: "test",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        messageCount: 0,
        lastSeenMessageId: "msg-existing",
      }]),
    );
    await mgr.loadFromDisk();

    mgr.recordActivity("s1");
    await new Promise((r) => setTimeout(r, 1100));

    const records = JSON.parse(await Deno.readTextFile(file));
    assertEquals(records[0].lastSeenMessageId, "msg-existing");
  });
});

Deno.test("setLastSeenMessageId advances bookmark explicitly", async () => {
  await withTempDir(async (dir) => {
    const mgr = new SessionThreadManager(dir);
    const file = path.join(dir, "session-threads.json");
    await Deno.writeTextFile(
      file,
      JSON.stringify([{
        sessionId: "s1",
        threadId: "t1",
        threadName: "test",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        messageCount: 0,
      }]),
    );
    await mgr.loadFromDisk();

    mgr.setLastSeenMessageId("s1", "msg-999");
    await new Promise((r) => setTimeout(r, 1100));

    const records = JSON.parse(await Deno.readTextFile(file));
    assertEquals(records[0].lastSeenMessageId, "msg-999");
  });
});
