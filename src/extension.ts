import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let currentProcess: ChildProcessWithoutNullStreams | null = null;
let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
	const runSMT2Command = vscode.commands.registerCommand('smt2.run', async (code?: string) => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			if (!code) {
				code = editor.document.getText();
			}

			const config = vscode.workspace.getConfiguration('smt-z3');
			const timeout = config.get<number>('timeout') ?? 60000;
			const showSolveTime = config.get<boolean>('showSolveTime') ?? true;

			const startTime = Date.now();

			try {
				const result = await runSMT2Code(code, timeout);
				const endTime = Date.now();
				const solveTime = endTime - startTime;
				const timestamp = new Date().toLocaleString();

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

				panel.webview.html = `<html><body>
                ${showSolveTime ? `<pre>;; Solver result (re)generated at ${timestamp} </pre>` : ''}
								${showSolveTime ? `<pre>;; Execution time: ${solveTime}ms</pre>` : ''}
                <pre>${result}</pre>
            </body></html>`;

				return result;

			} catch (error) {
				// If panel is not open, create it and show the error message
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
				// Show error message in the panel
				const errorMessage = error instanceof Error ? error.message : 'Error executing Z3';
				panel.webview.html = `<html><body><pre>${errorMessage}</pre></body></html>`;
				return errorMessage;
			}
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

	context.subscriptions.push(runSMT2Command, stopSMT2Command, openSettingsCommand);

	const codeLensProvider = new SMT2CodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'smt' }, codeLensProvider)
	);
}

async function runSMT2Code(code: string, timeout: number): Promise<string> {
	return new Promise((resolve, reject) => {

		const smtRunnerScript = require.resolve('./smt-runner');

		currentProcess = spawn(process.execPath, [smtRunnerScript], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let output = '';
		let error = '';

		currentProcess.stdin.write(code);
		currentProcess.stdin.end();

		currentProcess.stdout.on('data', (data) => {
			output += data.toString();
		});

		currentProcess.stderr.on('data', (data) => {
			error += data.toString();
		});

		currentProcess.on('close', (code) => {
			if (code === 0) {
				resolve(output.trim());
			} else {
				reject(new Error(error.trim() || 'Error executing Z3'));
			}
			currentProcess = null; // Reset the process reference
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
	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
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

		// Read configuration for showing current line code lens
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
