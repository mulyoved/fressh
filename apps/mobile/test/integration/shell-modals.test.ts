import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupBrowserActionRequests } from '../../src/lib/browser-actions-request-cleanup';
import {
	HostDiffityShareError,
	runHostDiffityOpenRequest,
	type HostDiffityOpenErrorReport,
	type HostDiffityShareResult,
} from '../../src/lib/host-diffity-open-request';
import { type RequestIdHandle } from '../../src/lib/request-id';

const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

void test('browser action request cleanup invalidates browser action requests', () => {
	const events: string[] = [];
	const requestId = (name: string): RequestIdHandle => ({
		next: () => 0,
		isCurrent: () => false,
		invalidate: () => events.push(`invalidate:${name}`),
	});
	const inFlightRefs = {
		hostUrlSubmit: { current: true },
		hostDiffity: { current: true },
		hostDetectedOpen: { current: true },
	};

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId('hostUrlRead'),
		hostUrlSubmitRequestId: requestId('hostUrlSubmit'),
		hostUrlSubmitInFlightRef: inFlightRefs.hostUrlSubmit,
		browserGitHubTargetRequestId: requestId('browserGitHubTarget'),
		hostDiffityRequestId: requestId('hostDiffity'),
		hostDiffityInFlightRef: inFlightRefs.hostDiffity,
		hostDetectedOpenRequestId: requestId('hostDetectedOpen'),
		hostDetectedOpenInFlightRef: inFlightRefs.hostDetectedOpen,
	});

	assert.deepEqual(events, [
		'invalidate:hostUrlRead',
		'invalidate:hostUrlSubmit',
		'invalidate:browserGitHubTarget',
		'invalidate:hostDiffity',
		'invalidate:hostDetectedOpen',
	]);
	assert.equal(inFlightRefs.hostUrlSubmit.current, false);
	assert.equal(inFlightRefs.hostDiffity.current, false);
	assert.equal(inFlightRefs.hostDetectedOpen.current, false);
});

void test('stale Diffity completion does not clear newer in-flight request', async () => {
	let currentId = 0;
	const nextIds = [1, 3];
	const requestId: RequestIdHandle = {
		next: () => {
			const next = nextIds.shift();
			if (next == null) throw new Error('missing next request id');
			currentId = next;
			return next;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const firstShare = deferred<HostDiffityShareResult>();
	const secondShare = deferred<HostDiffityShareResult>();
	const shares = [firstShare.promise, secondShare.promise];
	const openedUrls: string[] = [];
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: () => {
				const share = shares.shift();
				if (!share) throw new Error('missing Diffity share request');
				return share;
			},
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	requestId.invalidate();
	inFlightRef.current = false;
	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: () => {
				const share = shares.shift();
				if (!share) throw new Error('missing Diffity share request');
				return share;
			},
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	firstShare.resolve({ output: 'https://diffity.example/old' });
	await firstShare.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(openedUrls, []);

	secondShare.resolve({ output: 'https://diffity.example/new' });
	await secondShare.promise;
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(openedUrls, ['https://diffity.example/new']);
	assert.deepEqual(errors, []);
});

void test('browser action cleanup suppresses pending Diffity completion', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const share = deferred<HostDiffityShareResult>();
	const openedUrls: string[] = [];
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: () => share.promise,
			openAndroidUrl: async (url) => {
				openedUrls.push(url);
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId,
		hostUrlSubmitRequestId: requestId,
		hostUrlSubmitInFlightRef: { current: true },
		browserGitHubTargetRequestId: requestId,
		hostDiffityRequestId: requestId,
		hostDiffityInFlightRef: inFlightRef,
		hostDetectedOpenRequestId: requestId,
		hostDetectedOpenInFlightRef: { current: true },
	});
	assert.equal(inFlightRef.current, false);

	share.resolve({ output: 'https://diffity.example/backgrounded' });
	await share.promise;
	await Promise.resolve();
	assert.deepEqual(openedUrls, []);
	assert.deepEqual(errors, []);
	assert.equal(inFlightRef.current, false);
});

void test('current Diffity request reports missing HTTPS URL output with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	const shareResult: HostDiffityShareResult = {
		output: 'no url here',
		panePath: '/tmp/project',
		command: "cd '/tmp/project' && mdev diffity share",
	};

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => shareResult,
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'no url here',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			output: 'no url here',
		},
	]);
});

void test('current Diffity request reports Android URL open failures with extracted URL', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => ({
				output: 'created https://diffity.example/current',
				panePath: '/tmp/project',
				command: "cd '/tmp/project' && mdev diffity share",
			}),
			openAndroidUrl: async () => {
				throw new Error('cannot open URL');
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'cannot open URL',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
			url: 'https://diffity.example/current',
		},
	]);
});

void test('current Diffity request reports command rejection with command context', async () => {
	let currentId = 0;
	const requestId: RequestIdHandle = {
		next: () => {
			currentId += 1;
			return currentId;
		},
		isCurrent: (id) => id === currentId,
		invalidate: () => {
			currentId += 1;
		},
	};
	const inFlightRef = { current: false };
	const errors: HostDiffityOpenErrorReport[] = [];

	assert.equal(
		runHostDiffityOpenRequest({
			hostDiffityInFlightRef: inFlightRef,
			hostDiffityRequestId: requestId,
			runDiffityShare: async () => {
				throw new HostDiffityShareError({
					message: 'remote command failed',
					panePath: '/tmp/project',
					command: "cd '/tmp/project' && mdev diffity share",
					cause: new Error('remote command failed'),
				});
			},
			openAndroidUrl: async () => {
				throw new Error('should not open');
			},
			showError: (report) => {
				errors.push(report);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
		}),
		true,
	);

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, [
		{
			title: 'Diffity failed',
			message: 'remote command failed',
			panePath: '/tmp/project',
			command: "cd '/tmp/project' && mdev diffity share",
		},
	]);
});
