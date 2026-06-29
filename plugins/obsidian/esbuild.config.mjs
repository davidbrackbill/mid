import process from "node:process";
import esbuild from "esbuild";

const production = process.argv.includes("production");

const banner = `/*
This is a generated file. Do not edit directly.
Build from the obsidian/ source with \`npm run build\` (or \`npm run dev\` for watch).
*/`;

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	// The mid core lives at ../../../src and imports its siblings with explicit `.ts`
	// extensions (Bun convention); esbuild resolves those. We bundle the core +
	// dagre into main.js so the plugin is self-contained.
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
	],
	format: "cjs",
	target: "es2018",
	platform: "browser",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: production,
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
