import { build } from "esbuild";
import fs from "node:fs";
const result = await build({
  entryPoints: ["surf/vendor/cross-entry.cjs"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: "surf/cross.bundle.mjs",
  metafile: true,
  sourcemap: false,
});
fs.writeFileSync(
  "surf/cross-build.json",
  JSON.stringify({ inputs: Object.keys(result.metafile.inputs) }, null, 2) +
    "\n",
);
