import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";
import fsExtra from 'fs-extra';

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = process.argv[2] === "production";

// --- Read README content --- START ---
const readmePath = path.resolve('README.md'); // Get absolute path to README
let readmeContent = '';
try {
	readmeContent = fs.readFileSync(readmePath, 'utf-8');
	console.log('Read README.md for embedding.');
} catch (err) {
	console.error('Failed to read README.md for embedding:', err);
	readmeContent = 'Error: Could not load README content.'; // Fallback content
}
// --- Read README content --- END ---

// Define source and destination paths
const sourceDir = ".";
const destDirs = [
	"/Users/erictaylor/Documents/Author/Book Trisan Series/Trisan Obsidian Vault .nosync/.obsidian/plugins/manuscript-timeline",
	"/Users/erictaylor/Documents/Code Projects/Test Obsidian Vault/.obsidian/plugins/manuscript-timeline"
];

// Files to copy (in addition to the built JS)
const filesToCopy = [
	"manifest.json",
	"styles.css",
	// "screenshot.png" // Removed as it should be referenced via absolute URL in README
];

// Function to copy files AND the fonts directory
async function copyFiles() {
	const sourceFontsDir = path.join(sourceDir, 'fonts'); // Path to source fonts dir
	const fontsExist = fs.existsSync(sourceFontsDir);

	for (const destDir of destDirs) {
		// --- Copy individual files ---
		for (const file of filesToCopy) {
			const sourcePath = path.join(sourceDir, file);
			const destPath = path.join(destDir, file);
			
			// Check if source file exists
			if (fs.existsSync(sourcePath)) {
				try {
					// Create destination directory if it doesn't exist
					if (!fs.existsSync(path.dirname(destPath))) {
						fs.mkdirSync(path.dirname(destPath), { recursive: true });
					}
					
					// Copy the file
					fs.copyFileSync(sourcePath, destPath);
				} catch (err) {
					console.error(`Error copying ${file} to ${destDir}:`, err);
				}
			} else {
				console.warn(`Warning: ${sourcePath} does not exist, skipping.`);
			}
		}
		
		// --- Copy fonts directory recursively --- START ---
		if (fontsExist) {
			const destFontsDir = path.join(destDir, 'fonts'); // Path to dest fonts dir
			try {
				// Use fs-extra's copySync for simplicity
				fsExtra.copySync(sourceFontsDir, destFontsDir, { overwrite: true });
				console.log(`Copied fonts directory to ${destFontsDir}`);
			} catch (err) {
				console.error(`Error copying fonts directory to ${destDir}:`, err);
			}
		} else {
			console.warn(`Warning: Source fonts directory ${sourceFontsDir} does not exist, skipping font copy.`);
		}
		// --- Copy fonts directory recursively --- END ---

		// --- Copy main.js ---
		const mainJsPath = path.join(destDirs[0], "main.js");
		if (fs.existsSync(mainJsPath) && destDir !== destDirs[0]) {
			try {
				fs.copyFileSync(mainJsPath, path.join(destDir, "main.js"));
			} catch (err) {
				console.error(`Error copying main.js to ${destDir}:`, err);
			}
		}
	}
	
	console.log(`Build assets copied to: ${destDirs.join(", ")}`);
}

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ['main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'codemirror',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		...builtins,
	],
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outdir: destDirs[0],
	define: {
		'EMBEDDED_README_CONTENT': JSON.stringify(readmeContent)
	}
});

if (prod) {
	await context.rebuild();
	await copyFiles();
	console.log("Production build complete!");
	process.exit(0);
} else {
	await context.watch();
	// Copy files initially
	await copyFiles();
	console.log("Watching for changes...");
	
	// Set up file watchers for non-TS files
	filesToCopy.forEach(file => {
		const sourcePath = path.join(sourceDir, file);
		fs.watch(sourcePath, async () => {
			try {
				// Update file in all destination directories
				for (const destDir of destDirs) {
					const destPath = path.join(destDir, file);
					fs.copyFileSync(sourcePath, destPath);
				}
				console.log(`Files updated in all destination directories`);
			} catch (err) {
				console.error(`Error updating ${file}:`, err);
			}
		});
	});

	// Watch for main.js changes (the output file) and copy to other destinations
	const mainJsPath = path.join(destDirs[0], "main.js");
	fs.watch(mainJsPath, async () => {
		try {
			// Copy to all other destination directories
			for (let i = 1; i < destDirs.length; i++) {
				fs.copyFileSync(mainJsPath, path.join(destDirs[i], "main.js"));
			}
			console.log(`main.js updated in all destination directories`);
		} catch (err) {
			console.error(`Error updating main.js:`, err);
		}
	});
}
