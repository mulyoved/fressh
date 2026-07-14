import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const execFile = promisify(execFileCallback);
const representativeAndroidPaths = [
	'apps/mobile/android/settings.gradle',
	'apps/mobile/android/app/src/main/AndroidManifest.xml',
	'apps/mobile/android/gradle/wrapper/gradle-wrapper.properties',
];

const assertEasIgnoreExcludesAndroid = async (easIgnore: string) => {
	const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'fressh-eas-ignore-'));

	try {
		await execFile('git', ['init', '--quiet'], { cwd: fixtureRoot });
		await writeFile(path.join(fixtureRoot, '.gitignore'), easIgnore);

		for (const androidPath of representativeAndroidPaths) {
			try {
				await execFile(
					'git',
					['check-ignore', '--quiet', '--no-index', '--', androidPath],
					{ cwd: fixtureRoot },
				);
			} catch (error) {
				if ((error as { code?: unknown }).code === 1) {
					assert.fail(
						`EAS must exclude ${androidPath} so stale generated native code cannot skip Expo prebuild`,
					);
				}

				throw error;
			}
		}
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
};

void test('EAS excludes the generated Android project so prebuild always runs', async () => {
	const easIgnore = await readFile(path.join(repoRoot, '.easignore'), 'utf8');

	await assertEasIgnoreExcludesAndroid(easIgnore);
});

void test('EAS guard rejects later Android re-inclusion rules', async () => {
	await assert.rejects(
		assertEasIgnoreExcludesAndroid(`
apps/mobile/android/
!apps/mobile/android/
!apps/mobile/android/**
`),
		/EAS must exclude apps\/mobile\/android\//u,
	);
});

void test('EAS preview profile supplies the validated Gradle memory policy', async () => {
	const easJson = JSON.parse(
		await readFile(path.join(repoRoot, 'apps/mobile/eas.json'), 'utf8'),
	) as {
		build?: { preview?: { env?: Record<string, string> } };
	};

	assert.equal(
		easJson.build?.preview?.env?.GRADLE_OPTS,
		'-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m',
		'The preview profile must provide the Gradle memory required by the canonical build command',
	);
});
