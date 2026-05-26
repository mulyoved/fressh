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

export type SkillSelectorCommandRunner = (command: string) => Promise<string>;
export type SkillSelectorPanePathResolver = () => Promise<string>;

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
	runCommand,
	forceRefresh,
}: {
	cache: SkillDiscoveryCache;
	stableConnectionId: string;
	tmuxTarget: string;
	panePath?: string;
	resolvePanePath?: SkillSelectorPanePathResolver;
	runCommand: SkillSelectorCommandRunner;
	forceRefresh: boolean;
}): Promise<SkillSelectorProjectLoadResult> {
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

	const cacheKeyParts = {
		stableConnectionId,
		tmuxTarget,
		projectRoot: project.projectRoot,
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
		buildSkillDiscoveryCommand(resolvedPanePath),
	);
	const discoveryResult = parseSkillDiscoveryResult(discoveryOutput);
	if (!discoveryResult) {
		throw new Error('Skill discovery returned invalid output.');
	}

	const cacheRecord = cache.write({
		...cacheKeyParts,
		projectName: project.projectName,
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
