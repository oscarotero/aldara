import analyze from "../mod.ts";
import { defaults } from "./types.ts";
import { assertSnapshot } from "https://deno.land/std@0.200.0/testing/snapshot.ts";

Deno.test("analyze", async (t) => {
  const schema = await analyze(import.meta.resolve("./types.ts"), {
    defaults: { Blog: defaults },
  });
  await assertSnapshot(t, schema);
});
