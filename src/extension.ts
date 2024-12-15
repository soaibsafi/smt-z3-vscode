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

			const timeout = vscode.workspace.getConfiguration('smt-z3').get<number>('timeout') ?? 60000;

			try {
				const result = await runSMT2Code(code, timeout);

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

				panel.webview.html = `<html><body><pre>${result}</pre></body></html>`;
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

	context.subscriptions.push(runSMT2Command, stopSMT2Command);

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

		const runCodeLensCurrentLine = new vscode.CodeLens(currentLineRange, {
			title: '▶ Execute',
			command: 'smt2.run',
			arguments: [code]
		});

		const stopCodeLensCurrentLine = new vscode.CodeLens(currentLineRange, {
			title: '⏹ Stop',
			command: 'smt2.stop'
		});

		// If current position is at the top of the document, don't show the CodeLens
		if (vscode.window.activeTextEditor?.selection.active.line !== 0) {
			codeLens.push(runCodeLensCurrentLine, stopCodeLensCurrentLine);
		}

		return codeLens;
	}
}
