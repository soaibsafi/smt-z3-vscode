import * as vscode from 'vscode';
import { init } from 'z3-solver';

export function activate(context: vscode.ExtensionContext) {

	let panel: vscode.WebviewPanel | undefined;

	const runSMT2Command = vscode.commands.registerCommand('smt2.run', async (code?: string) => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			if (!code) {
				code = editor.document.getText();
			}
			try {
				const result = await runSMT2Code(code);

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
				if (panel) {
					const errorMessage = error instanceof Error ? error.message : 'Error executing Z3';
					panel.webview.html = `<html><body><pre>${errorMessage}</pre></body></html>`;
					return errorMessage;
				}
				return 'Error executing Z3';
			}
		}
	});

	context.subscriptions.push(runSMT2Command);

	const codeLensProvider = new SMT2CodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'smt' }, codeLensProvider)
	);

}

async function runSMT2Code(code: string): Promise<string> {
	try {
		const { Z3 } = await init();
		const cfg = Z3.mk_config();
		const ctx = Z3.mk_context(cfg);
		Z3.del_config(cfg);

		let output = '';
		let error = '';
		try {
			output = await Z3.eval_smtlib2_string(ctx, code);
		} catch (e: any) {
			error = e.toString();
		}
		return output || error;
	} catch (e: any) {
		throw new Error(`Error running SMT2 code: ${e.message}`);
	}
}

class SMT2CodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		const topOfDocument = new vscode.Range(0, 0, 0, 0);
		const code = document.getText();
		const codeLens = new vscode.CodeLens(topOfDocument, {
			title: '▶ Execute',
			command: 'smt2.run',
			arguments: [code]
		});
		return [codeLens];
	}
}