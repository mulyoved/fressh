export async function initializeSecretsManagerServices<Result>(params: {
	initializeSecureStorage: () => Promise<void>;
	ensureConnectionsReady: () => Promise<void>;
	recoverPendingRestore: () => Promise<Result>;
}): Promise<Result> {
	await Promise.all([
		params.initializeSecureStorage(),
		params.ensureConnectionsReady(),
	]);
	return params.recoverPendingRestore();
}
