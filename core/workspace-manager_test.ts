import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { WorkspaceManager } from "./workspace-manager.ts";

// --- resolve() ---

Deno.test("resolve: returns defaultWorkDir when no mapping exists", () => {
  const wm = new WorkspaceManager("/default/path");
  assertEquals(wm.resolve("unknown-channel"), "/default/path");
});

Deno.test("resolve: returns mapped path for known channel", () => {
  const wm = new WorkspaceManager("/default/path");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
  assertEquals(wm.resolve("chan-1"), "/projects/crm");
});

Deno.test("resolve: unmapped channel still falls back to default", () => {
  const wm = new WorkspaceManager("/default/path");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
  assertEquals(wm.resolve("chan-2"), "/default/path");
});

// --- add() ---

Deno.test("add: creates new entry", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "api", path: "/projects/api", channelId: "chan-1" });
  assertEquals(wm.list().length, 1);
  assertEquals(wm.list()[0].name, "api");
});

Deno.test("add: same name overwrites existing entry", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/old/crm", channelId: "chan-1" });
  wm.add({ name: "crm", path: "/new/crm", channelId: "chan-2" });

  const list = wm.list();
  assertEquals(list.length, 1);
  assertEquals(list[0].path, "/new/crm");
  assertEquals(list[0].channelId, "chan-2");
});

// --- remove() ---

Deno.test("remove: deletes entry and returns it", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });

  const removed = wm.remove("crm");
  assertEquals(removed?.name, "crm");
  assertEquals(wm.list().length, 0);
  assertEquals(wm.resolve("chan-1"), "/default");
});

Deno.test("remove: returns undefined for non-existent name", () => {
  const wm = new WorkspaceManager("/default");
  assertEquals(wm.remove("nope"), undefined);
});

// --- findByChannel() ---

Deno.test("findByChannel: finds entry by channel ID", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
  assertEquals(wm.findByChannel("chan-1")?.name, "crm");
});

Deno.test("findByChannel: returns undefined for unknown channel", () => {
  const wm = new WorkspaceManager("/default");
  assertEquals(wm.findByChannel("chan-99"), undefined);
});

// --- findByName() ---

Deno.test("findByName: finds entry by name", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
  assertEquals(wm.findByName("crm")?.channelId, "chan-1");
});

Deno.test("findByName: returns undefined for unknown name", () => {
  const wm = new WorkspaceManager("/default");
  assertEquals(wm.findByName("nope"), undefined);
});

// --- getManagedChannelIds() ---

Deno.test("getManagedChannelIds: includes default + workspace channels", () => {
  const wm = new WorkspaceManager("/default");
  wm.setDefaultChannelId("default-chan");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
  wm.add({ name: "api", path: "/projects/api", channelId: "chan-2" });

  const ids = wm.getManagedChannelIds();
  assertEquals(ids.has("default-chan"), true);
  assertEquals(ids.has("chan-1"), true);
  assertEquals(ids.has("chan-2"), true);
  assertEquals(ids.size, 3);
});

Deno.test("getManagedChannelIds: works without default channel set", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });

  const ids = wm.getManagedChannelIds();
  assertEquals(ids.size, 1);
  assertEquals(ids.has("chan-1"), true);
});

// --- persistence ---

Deno.test("saveToDisk + loadFromDisk: round-trips data", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const wm1 = new WorkspaceManager(tmpDir);
    wm1.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
    wm1.add({ name: "api", path: "/projects/api", channelId: "chan-2" });
    await wm1.saveToDisk();

    const wm2 = new WorkspaceManager(tmpDir);
    await wm2.loadFromDisk();

    assertEquals(wm2.list().length, 2);
    assertEquals(wm2.resolve("chan-1"), "/projects/crm");
    assertEquals(wm2.resolve("chan-2"), "/projects/api");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadFromDisk: handles missing file gracefully", async () => {
  const wm = new WorkspaceManager("/nonexistent/path");
  await wm.loadFromDisk();
  assertEquals(wm.list().length, 0);
});

// --- isAutoThreadChannel() ---

Deno.test("isAutoThreadChannel: returns false when not set", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });
  assertEquals(wm.isAutoThreadChannel("chan-1"), false);
});

Deno.test("isAutoThreadChannel: returns true when enabled", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1", autoThread: true });
  assertEquals(wm.isAutoThreadChannel("chan-1"), true);
});

Deno.test("isAutoThreadChannel: returns false for unknown channel", () => {
  const wm = new WorkspaceManager("/default");
  assertEquals(wm.isAutoThreadChannel("unknown"), false);
});

// --- setAutoThread() ---

Deno.test("setAutoThread: enables auto-thread on existing workspace", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1" });

  const result = wm.setAutoThread("crm", true);
  assertEquals(result?.autoThread, true);
  assertEquals(wm.isAutoThreadChannel("chan-1"), true);
});

Deno.test("setAutoThread: disables auto-thread", () => {
  const wm = new WorkspaceManager("/default");
  wm.add({ name: "crm", path: "/projects/crm", channelId: "chan-1", autoThread: true });

  const result = wm.setAutoThread("crm", false);
  assertEquals(result?.autoThread, false);
  assertEquals(wm.isAutoThreadChannel("chan-1"), false);
});

Deno.test("setAutoThread: returns undefined for non-existent workspace", () => {
  const wm = new WorkspaceManager("/default");
  assertEquals(wm.setAutoThread("nope", true), undefined);
});

Deno.test("saveToDisk + loadFromDisk: persists autoThread field", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const wm1 = new WorkspaceManager(tmpDir);
    wm1.add({ name: "crm", path: "/projects/crm", channelId: "chan-1", autoThread: true });
    await wm1.saveToDisk();

    const wm2 = new WorkspaceManager(tmpDir);
    await wm2.loadFromDisk();
    assertEquals(wm2.isAutoThreadChannel("chan-1"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- lastSeenMessageId ---

Deno.test("setLastSeenMessageId persists round-trip", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ws-mgr-test-" });
  try {
    const mgr1 = new WorkspaceManager(dir);
    await mgr1.loadFromDisk();
    mgr1.add({ name: "p", path: "/p", channelId: "ch1" });
    mgr1.setLastSeenMessageId("ch1", "msg-42");
    await mgr1.saveToDisk();

    const mgr2 = new WorkspaceManager(dir);
    await mgr2.loadFromDisk();
    assertEquals(mgr2.getLastSeenMessageId("ch1"), "msg-42");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("getLastSeenMessageId returns undefined for unknown channel", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ws-mgr-test-" });
  try {
    const mgr = new WorkspaceManager(dir);
    await mgr.loadFromDisk();
    assertEquals(mgr.getLastSeenMessageId("nope"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("setLastSeenMessageId on unknown channel is a no-op", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ws-mgr-test-" });
  try {
    const mgr = new WorkspaceManager(dir);
    await mgr.loadFromDisk();
    mgr.setLastSeenMessageId("nope", "msg-1"); // should not throw
    assertEquals(mgr.getLastSeenMessageId("nope"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
