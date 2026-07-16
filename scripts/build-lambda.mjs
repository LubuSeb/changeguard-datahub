import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const output = new URL("../dist-lambda/", import.meta.url);
const publicOutput = new URL("./public/", output);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["src/server/lambda.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile: "dist-lambda/index.cjs",
  sourcemap: true,
  minify: false,
});
await cp(new URL("../dist-client/", import.meta.url), publicOutput, { recursive: true });
await writeFile(new URL("./package.json", output), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

console.log("Lambda artifact built at dist-lambda/index.cjs with dist-lambda/public.");
