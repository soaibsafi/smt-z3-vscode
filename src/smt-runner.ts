import { init } from 'z3-solver';

void (async () => {
	try {
		const { Z3 } = await init();
		const cfg = Z3.mk_config();
		const ctx = Z3.mk_context(cfg);
		Z3.del_config(cfg);

		process.stdin.setEncoding('utf-8');
		let code = '';
		process.stdin.on('data', (chunk: string) => {
			code += chunk;
		});

		process.stdin.on('end', async () => {
			try {
				const result = await Z3.eval_smtlib2_string(ctx, code);
				console.log(result);
				process.exit(0);
			} catch (e: unknown) {
				console.error(String(e));
				process.exit(1);
			}
		});
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`Initialization error: ${message}`);
		process.exit(1);
	}
})();
