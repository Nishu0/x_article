import { mkdir, copyFile } from "fs/promises";

async function build() {
  // Ensure dist directory exists
  await mkdir("./dist", { recursive: true });

  // Bundle TypeScript files
  const entrypoints = [
    "./src/content.ts",
    "./src/popup.ts",
    "./src/background.ts"
  ];

  const result = await Bun.build({
    entrypoints,
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

  // Copy HTML file
  await copyFile("./src/popup.html", "./dist/popup.html");

  // Note: Icons are managed manually in ./icons folder - build does not touch them

  console.log("Build successful! Output in ./dist/");
  console.log("Files built:", result.outputs.map(o => o.path));
}

build();
