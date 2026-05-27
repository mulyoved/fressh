import {
	buildSkillDiscoveryCommand,
	buildSkillProjectCommand,
	parseSkillDiscoveryResult,
	parseSkillProjectOutput,
	type DiscoveredSkill,
} from '@/lib/skill-discovery';
import {
	type SkillDiscoveryCache,
	type SkillDiscoveryCacheRecord,
} from '@/lib/skill-discovery-cache';
import { type TmuxProjectMetadata } from '@/lib/tmux-project-metadata';

export type SkillSelectorCommandRunner = (command: string) => Promise<string>;
export type SkillSelectorPanePathResolver = () => Promise<string>;
export type SkillSelectorProjectMetadataResolver =
	() => Promise<TmuxProjectMetadata>;

export type SkillSelectorProjectLoadResult = {
	source: 'cache' | 'remote';
	projectRoot: string;
	projectName: string;
	skills: DiscoveredSkill[];
	updatedAt: string | null;
	cacheRecord: SkillDiscoveryCacheRecord | null;
};

export async function loadSkillSelectorProject({
	cache,
	stableConnectionId,
	tmuxTarget,
	panePath,
	resolvePanePath,
	projectMetadata,
	resolveProjectMetadata,
	runCommand,
	forceRefresh,
}: {
	cache: SkillDiscoveryCache;
	stableConnectionId: string;
	tmuxTarget: string;
	panePath?: string;
	resolvePanePath?: SkillSelectorPanePathResolver;
	projectMetadata?: TmuxProjectMetadata | null;
	resolveProjectMetadata?: SkillSelectorProjectMetadataResolver;
	runCommand: SkillSelectorCommandRunner;
	forceRefresh: boolean;
}): Promise<SkillSelectorProjectLoadResult> {
	const metadata =
		forceRefresh && resolveProjectMetadata
			? await resolveProjectMetadata()
			: (projectMetadata ?? (await resolveProjectMetadata?.()) ?? null);

	if (metadata) {
		return loadSkillSelectorProjectFromResolvedProject({
			cache,
			stableConnectionId,
			tmuxTarget,
			panePath: metadata.panePath,
			projectRoot: metadata.projectRoot,
			projectName: metadata.projectName,
			runCommand,
			forceRefresh,
		});
	}

	const resolvedPanePath = panePath ?? (await resolvePanePath?.());
	if (!resolvedPanePath) {
		throw new Error('Could not resolve pane path for skill selector.');
	}

	const projectOutput = await runCommand(
		buildSkillProjectCommand(resolvedPanePath),
	);
	const project = parseSkillProjectOutput(projectOutput);
	if (!project) {
		throw new Error('Could not resolve skill project for current pane.');
	}

	return loadSkillSelectorProjectFromResolvedProject({
		cache,
		stableConnectionId,
		tmuxTarget,
		panePath: resolvedPanePath,
		projectRoot: project.projectRoot,
		projectName: project.projectName,
		runCommand,
		forceRefresh,
	});
}

async function loadSkillSelectorProjectFromResolvedProject({
	cache,
	stableConnectionId,
	tmuxTarget,
	panePath,
	projectRoot,
	projectName,
	runCommand,
	forceRefresh,
}: {
	cache: SkillDiscoveryCache;
	stableConnectionId: string;
	tmuxTarget: string;
	panePath: string;
	projectRoot: string;
	projectName: string;
	runCommand: SkillSelectorCommandRunner;
	forceRefresh: boolean;
}): Promise<SkillSelectorProjectLoadResult> {
	const cacheKeyParts = {
		stableConnectionId,
		tmuxTarget,
		projectRoot,
	};

	if (!forceRefresh) {
		const cacheRecord = cache.read(cacheKeyParts);
		if (cacheRecord) {
			return {
				source: 'cache',
				projectRoot: cacheRecord.projectRoot,
				projectName: cacheRecord.projectName,
				skills: cacheRecord.skills,
				updatedAt: cacheRecord.updatedAt,
				cacheRecord,
			};
		}
	}

	const discoveryOutput = await runCommand(
		buildSkillDiscoveryCommand(panePath),
	);
	const discoveryResult = parseSkillDiscoveryResult(discoveryOutput);
	if (!discoveryResult) {
		throw new Error('Skill discovery returned invalid output.');
	}

	const cacheRecord = cache.write({
		...cacheKeyParts,
		projectName,
		skills: discoveryResult.skills,
	});

	return {
		source: 'remote',
		projectRoot: cacheRecord.projectRoot,
		projectName: cacheRecord.projectName,
		skills: cacheRecord.skills,
		updatedAt: cacheRecord.updatedAt,
		cacheRecord,
	};
}
