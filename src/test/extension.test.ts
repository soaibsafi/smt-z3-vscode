import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('should activate the extension', async () => {
		const extension = vscode.extensions.getExtension('soaibuzzaman.smt-z3');
		await extension?.activate();
		assert.ok(extension?.isActive);
	});

	test('should register smt2.run command', async () => {
		const command = await vscode.commands.getCommands(true);
		assert.ok(command.includes('smt2.run'));
	});

	test('should return sat', async () => {
		const smtLibContent = `
            (declare-const x Int)
            (assert (and (>= x 0) (<= x 10)))
            (check-sat)
        `;
		const editor = await vscode.workspace.openTextDocument({ content: smtLibContent });
		await vscode.window.showTextDocument(editor);

		try {
			const result = await vscode.commands.executeCommand('smt2.run', smtLibContent);
			console.log('Command result:', result);
			assert.strictEqual(result, 'sat\n');
		} catch (error) {
			console.error('Error executing command:', error);
			assert.fail('Command execution failed');
		}
	});

	test('should return unsat', async () => {
		const smtLibContent = `
					(declare-const x Int)
					(assert (and (>= x 0) (<= x 10)))
					(assert (> x 10))
					(check-sat)
			`;
		const editor = await vscode.workspace.openTextDocument({ content: smtLibContent });
		await vscode.window.showTextDocument(editor);

		try {
			const result = await vscode.commands.executeCommand('smt2.run', smtLibContent);
			console.log('Command result:', result);
			assert.strictEqual(result, 'unsat\n');
		} catch (error) {
			console.error('Error executing command:', error);
			assert.fail('Command execution failed');
		}
	});
});