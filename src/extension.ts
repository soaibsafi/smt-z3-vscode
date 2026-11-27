import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node.js';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';

let client: LanguageClient | undefined;
let currentProcess: ChildProcessWithoutNullStreams | null = null;
let panel: vscode.WebviewPanel | undefined;

const LSP_ANNOUNCEMENT_KEY = 'smt-z3.lspAnnouncementShown.v5.4';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	if (isLspEnabled()) {
		client = await startLanguageClient(context);
	}

	void showLspAnnouncementOnce(context);

	const configListener = vscode.workspace.onDidChangeConfiguration(async event => {
		if (!event.affectsConfiguration('smt-z3.enableLsp')) {
			return;
		}
		if (isLspEnabled()) {
			if (!client) {
				client = await startLanguageClient(context);
				vscode.window.showInformationMessage('SMT-LIB language server enabled.');
			}
		} else if (client) {
			await client.stop();
			client = undefined;
			vscode.window.showInformationMessage('SMT-LIB language server disabled.');
		}
	});

	const restartServerCommand = vscode.commands.registerCommand('smt2.restartServer', async () => {
		if (!isLspEnabled()) {
			const choice = await vscode.window.showWarningMessage(
				'SMT-LIB language server is currently disabled in settings.',
				'Enable LSP',
				'Open Settings'
			);
			if (choice === 'Enable LSP') {
				await vscode.workspace.getConfiguration('smt-z3').update('enableLsp', true, vscode.ConfigurationTarget.Global);
			} else if (choice === 'Open Settings') {
				await vscode.commands.executeCommand('workbench.action.openSettings', 'smt-z3.enableLsp');
			}
			return;
		}
		await client?.stop();
		client = await startLanguageClient(context);
		vscode.window.showInformationMessage('SMT-LIB language server restarted.');
	});

	const runSMT2Command = vscode.commands.registerCommand('smt2.run', async (code?: string) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return undefined;
		}
		if (!code) {
			code = editor.document.getText();
		}

		const config = vscode.workspace.getConfiguration('smt-z3');
		const timeout = config.get<number>('timeout') ?? 60000;
		const showSolveTime = config.get<boolean>('showSolveTime') ?? true;

		const startTime = Date.now();

		try {
			const result = await runSMT2Code(context, code, timeout);
			const endTime = Date.now();
			const solveTime = endTime - startTime;
			const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];

			ensureOutputPanel().webview.html = renderOutputHtml(result, {
				showSolveTime,
				timestamp,
				solveTime
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Error executing Z3';
			ensureOutputPanel().webview.html = renderOutputHtml(errorMessage);
			return errorMessage;
		}
	});

	const stopSMT2Command = vscode.commands.registerCommand('smt2.stop', async () => {
		if (currentProcess) {
			currentProcess.kill('SIGKILL');
			currentProcess = null;
			vscode.window.showInformationMessage('Z3 execution stopped.', 'OK');
		} else {
			vscode.window.showWarningMessage('Currently there is no Z3 process running.', 'OK');
		}
	});

	const openSettingsCommand = vscode.commands.registerCommand('smt2.openSettings', async () => {
		await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Soaibuzzaman.smt-z3');
	});

	const codeLensProvider = new SMT2CodeLensProvider();

	context.subscriptions.push(
		configListener,
		restartServerCommand,
		runSMT2Command,
		stopSMT2Command,
		openSettingsCommand,
		vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'smt' }, codeLensProvider)
	);
}

export async function deactivate(): Promise<void> {
	if (currentProcess) {
		currentProcess.kill('SIGKILL');
		currentProcess = null;
	}
	await client?.stop();
	client = undefined;
}

function isLspEnabled(): boolean {
	return vscode.workspace.getConfiguration('smt-z3').get<boolean>('enableLsp') ?? true;
}

async function showLspAnnouncementOnce(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(LSP_ANNOUNCEMENT_KEY)) {
		return;
	}
	await context.globalState.update(LSP_ANNOUNCEMENT_KEY, true);

	const selection = await vscode.window.showInformationMessage(
		'SMT Z3 now includes experimental Language Server (LSP) support (diagnostics, completion, hover, and formatting). You can disable it anytime in settings.',
		'Disable LSP',
		'Open Settings'
	);
	if (selection === 'Disable LSP') {
		await vscode.workspace.getConfiguration('smt-z3').update('enableLsp', false, vscode.ConfigurationTarget.Global);
	} else if (selection === 'Open Settings') {
		await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Soaibuzzaman.smt-z3');
	}
}

function ensureOutputPanel(): vscode.WebviewPanel {
	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			'z3Output',
			'Z3 Output',
			vscode.ViewColumn.Two,
			{}
		);

		panel.onDidDispose(() => {
			panel = undefined;
		});
	}
	return panel;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderOutputHtml(
	output: string,
	meta?: { showSolveTime: boolean; timestamp: string; solveTime: number }
): string {
	const header = meta?.showSolveTime
		? `<pre>;; Solver result (re)generated at ${escapeHtml(meta.timestamp)} </pre>\n<pre>;; Execution time: ${meta.solveTime}ms</pre>\n`
		: '';
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none';">
</head>
<body>
	${header}<pre>${escapeHtml(output)}</pre>
</body>
</html>`;
}

async function runSMT2Code(context: vscode.ExtensionContext, code: string, timeout: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const smtRunnerScript = context.asAbsolutePath(path.join('out', 'extension', 'smt-runner.cjs'));

		currentProcess = spawn(process.execPath, [smtRunnerScript], {
			stdio: ['pipe', 'pipe', 'pipe']
		});

		let output = '';
		let error = '';

		currentProcess.stdin.write(code);
		currentProcess.stdin.end();

		currentProcess.stdout.on('data', (data: Buffer) => {
			output += data.toString();
		});

		currentProcess.stderr.on('data', (data: Buffer) => {
			error += data.toString();
		});

		currentProcess.on('close', (exitCode: number | null) => {
			if (exitCode === 0) {
				resolve(output.trim());
			} else {
				reject(new Error(error.trim() || 'Error executing Z3'));
			}
			currentProcess = null;
		});

		const timer = setTimeout(() => {
			if (currentProcess) {
				currentProcess.kill('SIGKILL');
				reject(new Error('SMT code execution timed out'));
			}
		}, timeout);

		currentProcess.on('exit', () => {
			clearTimeout(timer);
		});
	});
}

class SMT2CodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
		const codeLens: vscode.CodeLens[] = [];
		const topOfDocument = new vscode.Range(0, 0, 0, 0);
		const code = document.getText();
		const currentLine = document.lineAt(vscode.window.activeTextEditor?.selection.active.line ?? 0);
		const currentLineRange = new vscode.Range(currentLine.range.start, currentLine.range.end);

		const runCodeLens = new vscode.CodeLens(topOfDocument, {
			title: '▶ Execute',
			command: 'smt2.run',
			arguments: [code]
		});

		const stopCodeLens = new vscode.CodeLens(topOfDocument, {
			title: '⏹ Stop',
			command: 'smt2.stop'
		});
		codeLens.push(runCodeLens, stopCodeLens);

		const showCurrentLineCodeLens = vscode.workspace.getConfiguration('smt-z3').get<boolean>('showCurrentLineCodeLens') ?? true;

		if (showCurrentLineCodeLens && vscode.window.activeTextEditor?.selection.active.line !== 0) {
			const runCodeLensCurrentLine = new vscode.CodeLens(currentLineRange, {
				title: '▶ Execute',
				command: 'smt2.run',
				arguments: [code]
			});

			const stopCodeLensCurrentLine = new vscode.CodeLens(currentLineRange, {
				title: '⏹ Stop',
				command: 'smt2.stop'
			});

			codeLens.push(runCodeLensCurrentLine, stopCodeLensCurrentLine);
		}

		return codeLens;
	}
}

async function startLanguageClient(context: vscode.ExtensionContext): Promise<LanguageClient> {
	const serverModule = context.asAbsolutePath(path.join('out', 'language', 'main.cjs'));
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach for debugging.
	// Set `DEBUG_BREAK` to wait until a debugger is attached.
	const debugOptions = {
		execArgv: ['--nolazy', `--inspect${process.env.DEBUG_BREAK ? '-brk' : ''}=${process.env.DEBUG_SOCKET || '6009'}`]
	};

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: '*', language: 'smt' }]
	};

	const newClient = new LanguageClient('smt', 'SMT-LIB Language Server', serverOptions, clientOptions);
	await newClient.start();
	return newClient;
}
