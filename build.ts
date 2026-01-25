import { mkdir } from "fs/promises";

async function build() {
  // Ensure dist directory exists
  await mkdir("./dist", { recursive: true });

  // Bundle content script
  const result = await Bun.build({
    entrypoints: ["./src/content.ts"],
    outdir: "./dist",
    target: "browser",
    minify: false,
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.log("Build successful! Output in ./dist/");
}

build();
