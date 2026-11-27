import * as assert from 'assert';
import * as vscode from 'vscode';

async function waitForDiagnostics(
	uri: vscode.Uri,
	predicate: (diagnostics: readonly vscode.Diagnostic[]) => boolean,
	timeoutMs = 15000
): Promise<readonly vscode.Diagnostic[]> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const diagnostics = vscode.languages.getDiagnostics(uri);
		if (predicate(diagnostics)) {
			return diagnostics;
		}
		await new Promise(resolve => setTimeout(resolve, 150));
	}
	return vscode.languages.getDiagnostics(uri);
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('should activate the extension', async () => {
		const extension = vscode.extensions.getExtension('Soaibuzzaman.smt-z3');
		await extension?.activate();
		assert.ok(extension?.isActive);
	});

	test('should register extension commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('smt2.run'));
		assert.ok(commands.includes('smt2.stop'));
		assert.ok(commands.includes('smt2.restartServer'));
	});

	test('should return sat', async () => {
		const smtLibContent = `
			(declare-const x Int)
			(assert (and (>= x 0) (<= x 10)))
			(check-sat)
		`;
		const document = await vscode.workspace.openTextDocument({ content: smtLibContent, language: 'smt' });
		await vscode.window.showTextDocument(document);

		const result = await vscode.commands.executeCommand<string>('smt2.run', smtLibContent);
		assert.strictEqual(result?.trim(), 'sat');
	});

	test('should return unsat', async () => {
		const smtLibContent = `
			(declare-const x Int)
			(assert (and (>= x 0) (<= x 10)))
			(assert (> x 10))
			(check-sat)
		`;
		const document = await vscode.workspace.openTextDocument({ content: smtLibContent, language: 'smt' });
		await vscode.window.showTextDocument(document);

		const result = await vscode.commands.executeCommand<string>('smt2.run', smtLibContent);
		assert.strictEqual(result?.trim(), 'unsat');
	});

	test('should publish LSP diagnostics for unknown symbols', async () => {
		const document = await vscode.workspace.openTextDocument({
			content: '(assert (> unknown_var 0))\n(check-sat)\n',
			language: 'smt'
		});
		await vscode.window.showTextDocument(document);

		const diagnostics = await waitForDiagnostics(document.uri, diags => diags.length > 0);
		assert.ok(diagnostics.length > 0, 'Expected LSP diagnostics for unknown_var');
	});
});
