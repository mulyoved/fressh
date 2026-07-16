import ts from 'typescript';

const RAW_NATIVE_DIAGNOSTIC_METHODS = new Set(['bufferStats', 'currentSeq']);

export function findRawNativeDiagnosticInvocations(source: string): string[] {
	const sourceFile = ts.createSourceFile(
		'production-source.tsx',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const invocations: string[] = [];

	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		) {
			const method = node.expression.name.text;
			if (RAW_NATIVE_DIAGNOSTIC_METHODS.has(method)) {
				invocations.push(method);
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return invocations;
}
