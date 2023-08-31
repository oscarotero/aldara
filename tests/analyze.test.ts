import analyze, { mergeDefaults } from "../mod.ts";
import { defaults } from "./types.ts";
import { assertSnapshot } from "https://deno.land/std@0.200.0/testing/snapshot.ts";

Deno.test("analyze", async (t) => {
  const schema = await analyze(import.meta.resolve("./types.ts"), {
    private: true,
  });
  mergeDefaults(schema.Blog, defaults);
  await assertSnapshot(t, schema);
});

Deno.test("analyze remote", async (t) => {
  const schema = await analyze(
    "https://deno.land/x/lume@v1.18.4/plugins/esbuild.ts",
  );
  await assertSnapshot(t, schema);
});
