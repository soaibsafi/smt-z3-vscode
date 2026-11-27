//@ts-check
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const success = watch ? 'Watch build succeeded' : 'Build succeeded';

function getTime() {
    const date = new Date();
    return `[${`${padZeroes(date.getHours())}:${padZeroes(date.getMinutes())}:${padZeroes(date.getSeconds())}`}] `;
}

function padZeroes(i) {
    return i.toString().padStart(2, '0');
}

function copyZ3RuntimeAssets() {
    const z3BuildDir = path.dirname(require.resolve('z3-solver/build/z3-built.js'));
    const outExtensionDir = path.resolve('out', 'extension');
    fs.mkdirSync(outExtensionDir, { recursive: true });
    for (const file of ['z3-built.js', 'z3-built.wasm']) {
        fs.copyFileSync(path.join(z3BuildDir, file), path.join(outExtensionDir, file));
    }
    fs.writeFileSync(path.join(outExtensionDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
}

function copyTextMateGrammar() {
    const grammarSource = require.resolve('@se-buw/smt-language/syntaxes/smt.tmLanguage.json');
    const syntaxesDir = path.resolve('syntaxes');
    fs.mkdirSync(syntaxesDir, { recursive: true });
    fs.copyFileSync(grammarSource, path.join(syntaxesDir, 'smt.tmLanguage.json'));
}

const plugins = [{
    name: 'assets-and-watch-plugin',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length === 0) {
                copyZ3RuntimeAssets();
                copyTextMateGrammar();
                console.log(getTime() + success);
            }
        });
    },
}];

const ctx = await esbuild.context({
    // Entry points for the VS Code extension, the Z3 runner, and the language server
    entryPoints: {
        'extension/main': 'src/extension.ts',
        'extension/smt-runner': 'src/smt-runner.ts',
        'language/main': 'src/server/main.ts',
    },
    outdir: 'out',
    bundle: true,
    target: 'ES2020',
    // VS Code's extension host uses CommonJS
    format: 'cjs',
    outExtension: {
        '.js': '.cjs',
    },
    loader: { '.ts': 'ts' },
    external: ['vscode', './z3-built'],
    platform: 'node',
    sourcemap: !minify,
    minify,
    plugins,
});

if (watch) {
    await ctx.watch();
} else {
    await ctx.rebuild();
    await ctx.dispose();
}
