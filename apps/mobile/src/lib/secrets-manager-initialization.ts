export async function initializeSecretsManagerServices<Result>(params: {
	initializeSecureStorage: () => Promise<void>;
	ensureConnectionsReady: () => Promise<void>;
	recoverPendingRestore: () => Promise<Result>;
}): Promise<Result> {
	await params.initializeSecureStorage();
	await params.ensureConnectionsReady();
	return params.recoverPendingRestore();
}
