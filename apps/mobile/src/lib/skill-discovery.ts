import { quoteShell } from '@/lib/host-browser-actions';

export type DiscoveredSkill = {
	name: string;
	directoryName: string;
	path: string;
	description: string | null;
};

export type DiscoveredSkillInput = Omit<DiscoveredSkill, 'directoryName'> & {
	directoryName?: string;
};

export type SkillProject = {
	projectRoot: string;
	projectName: string;
};

export type SkillDiscoveryResult = SkillProject & {
	skills: DiscoveredSkill[];
};

type SkillDiscoveryRecord = {
	path: string;
	content: string;
};

type SkillDiscoveryEnvelope = {
	projectRoot: string;
	records: SkillDiscoveryRecord[];
};

const skillPathPattern =
	/\/\.(?:agents|claude|codex)\/skills\/([^/]+)\/SKILL\.md$/;
const skillSourcePattern =
	/\/\.(agents|codex|claude)\/skills\/[^/]+\/SKILL\.md$/;

export function parseSkillDiscoveryOutput(output: string): DiscoveredSkill[] {
	const result = parseSkillDiscoveryResult(output);
	return result ? result.skills : [];
}

function normalizeSkillDiscoveryOutput(output: string): string {
	const trimmed = output.trim();
	if (trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;

	const envelopeStartIndex = trimmed.indexOf('{"projectRoot"');
	if (envelopeStartIndex >= 0) return trimmed.slice(envelopeStartIndex);

	const recordStartIndex = trimmed.indexOf('[{"path"');
	if (recordStartIndex < 0) return trimmed;
	return trimmed.slice(recordStartIndex);
}

export function getSkillProjectName(projectRoot: string): string {
	const normalized = projectRoot.replace(/\/+$/, '');
	if (!normalized) return '/';
	return normalized.split('/').at(-1) || normalized || '/';
}

export function parseSkillProjectOutput(output: string): SkillProject | null {
	if (!output.trim()) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(normalizeSkillDiscoveryOutput(output));
	} catch {
		return null;
	}

	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		typeof (parsed as SkillProject).projectRoot !== 'string'
	) {
		return null;
	}

	const projectRoot = (parsed as SkillProject).projectRoot;
	return {
		projectRoot,
		projectName: getSkillProjectName(projectRoot),
	};
}

export function parseSkillDiscoveryResult(
	output: string,
): SkillDiscoveryResult | null {
	if (!output.trim()) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(normalizeSkillDiscoveryOutput(output));
	} catch {
		return null;
	}

	if (Array.isArray(parsed)) {
		return {
			projectRoot: '',
			projectName: '',
			skills: parseSkillDiscoveryRecords(parsed),
		};
	}

	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		typeof (parsed as SkillDiscoveryEnvelope).projectRoot !== 'string' ||
		!Array.isArray((parsed as SkillDiscoveryEnvelope).records)
	) {
		return null;
	}

	const envelope = parsed as SkillDiscoveryEnvelope;
	return {
		projectRoot: envelope.projectRoot,
		projectName: getSkillProjectName(envelope.projectRoot),
		skills: parseSkillDiscoveryRecords(envelope.records),
	};
}

function parseSkillDiscoveryRecords(records: unknown[]): DiscoveredSkill[] {
	return normalizeDiscoveredSkills(
		records.flatMap((record): DiscoveredSkill[] => {
			if (!isSkillDiscoveryRecord(record)) return [];

			const pathMatch = record.path.match(skillPathPattern);
			if (!pathMatch) return [];

			const fallbackName = pathMatch[1];
			if (!fallbackName) return [];
			const metadata = parseSkillFrontmatter(record.content);
			return [
				{
					name: metadata.name || fallbackName,
					directoryName: fallbackName,
					path: record.path,
					description: metadata.description,
				},
			];
		}),
	);
}

export function normalizeDiscoveredSkills(
	skills: readonly DiscoveredSkillInput[],
): DiscoveredSkill[] {
	const deduped = new Map<string, DiscoveredSkill>();
	for (const skill of skills) {
		const normalizedSkill = normalizeDiscoveredSkill(skill);
		const duplicateKey = normalizedSkill.name.toLowerCase();
		const existingSkill = deduped.get(duplicateKey);
		if (
			!existingSkill ||
			compareSkillSourcePriority(normalizedSkill, existingSkill) < 0
		) {
			deduped.set(duplicateKey, normalizedSkill);
		}
	}
	return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeDiscoveredSkill(
	skill: DiscoveredSkillInput,
): DiscoveredSkill {
	return {
		...skill,
		directoryName:
			skill.directoryName || getSkillDirectoryNameFromPath(skill.path),
	};
}

export function getSkillDirectoryNameFromPath(path: string): string {
	const pathMatch = path.match(skillPathPattern);
	return pathMatch?.[1] ?? '';
}

function compareSkillSourcePriority(
	left: DiscoveredSkill,
	right: DiscoveredSkill,
): number {
	const priorityDelta =
		getSkillSourcePriority(left.path) - getSkillSourcePriority(right.path);
	if (priorityDelta !== 0) return priorityDelta;
	return left.path.localeCompare(right.path);
}

function getSkillSourcePriority(path: string): number {
	const source = path.match(skillSourcePattern)?.[1];
	if (source === 'agents') return 0;
	if (source === 'codex') return 1;
	if (source === 'claude') return 2;
	return 3;
}

export function filterDiscoveredSkills(
	skills: readonly DiscoveredSkillInput[],
	query: string,
): DiscoveredSkill[] {
	const normalizedQuery = query.trim().toLowerCase();
	const normalizedSkills = normalizeDiscoveredSkills(skills);
	if (!normalizedQuery) return normalizedSkills;

	return normalizedSkills
		.map((skill) => ({
			skill,
			rank: getSkillSearchRank(skill, normalizedQuery),
		}))
		.filter(
			(match): match is { skill: DiscoveredSkill; rank: number } =>
				match.rank !== null,
		)
		.sort((a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name))
		.map((match) => match.skill);
}

function getSkillSearchRank(
	skill: DiscoveredSkill,
	normalizedQuery: string,
): number | null {
	const normalizedName = skill.name.toLowerCase();
	const normalizedDirectoryName = skill.directoryName.toLowerCase();
	const normalizedDescription = (skill.description ?? '').toLowerCase();
	const normalizedPath = skill.path.toLowerCase();

	if (normalizedName === normalizedQuery) return 1;
	if (normalizedName.startsWith(normalizedQuery)) return 2;
	if (normalizedName.includes(normalizedQuery)) return 3;
	if (normalizedDirectoryName === normalizedQuery) return 4;
	if (normalizedDirectoryName.startsWith(normalizedQuery)) return 5;
	if (normalizedDirectoryName.includes(normalizedQuery)) return 6;
	if (normalizedDescription.startsWith(normalizedQuery)) return 7;
	if (normalizedDescription.includes(normalizedQuery)) return 8;
	if (normalizedPath.includes(normalizedQuery)) return 9;
	return null;
}

export function buildSkillDiscoveryCommand(panePath: string): string {
	const scriptBody = [
		'import json,pathlib,subprocess,sys',
		'start=pathlib.Path(sys.argv[1])',
		'try:',
		"    git=subprocess.run(['git','-C',str(start),'rev-parse','--show-toplevel'], text=True, capture_output=True)",
		'except OSError:',
		'    git=None',
		'base=pathlib.Path(git.stdout.strip()) if git and git.returncode == 0 and git.stdout.strip() else start',
		"skill_dirs=('.agents','.claude','.codex')",
		'bases=[base]',
		'home=pathlib.Path.home()',
		'if base == home:',
		'    try: children=sorted(child for child in home.iterdir() if child.is_dir())',
		'    except OSError: children=[]',
		'    for child in children:',
		"        if any((child/name/'skills').is_dir() for name in skill_dirs): bases.append(child)",
		'roots=[]',
		'seen=set()',
		'for current_base in bases:',
		'    for name in skill_dirs:',
		"        root=current_base/name/'skills'",
		'        root_key=str(root)',
		'        if root_key not in seen:',
		'            seen.add(root_key)',
		'            roots.append(root)',
		'records=[]',
		'for root in roots:',
		"    for skill_file in sorted(root.glob('*/SKILL.md')):",
		"        try: content=skill_file.read_text(encoding='utf-8', errors='replace')",
		'        except OSError: continue',
		"        records.append({'path': str(skill_file), 'content': content})",
		"print(json.dumps({'projectRoot': str(base), 'records': records}))",
	].join('\n');
	const script = `exec(${JSON.stringify(scriptBody)})`;
	return `python3 -c ${quoteShell(script)} ${quoteShell(panePath)}`;
}

export function buildSkillProjectCommand(panePath: string): string {
	const scriptBody = [
		'import json,pathlib,subprocess,sys',
		'start=pathlib.Path(sys.argv[1])',
		'try:',
		"    git=subprocess.run(['git','-C',str(start),'rev-parse','--show-toplevel'], text=True, capture_output=True)",
		'except OSError:',
		'    git=None',
		'base=pathlib.Path(git.stdout.strip()) if git and git.returncode == 0 and git.stdout.strip() else start',
		"print(json.dumps({'projectRoot': str(base)}))",
	].join('\n');
	const script = `exec(${JSON.stringify(scriptBody)})`;
	return `python3 -c ${quoteShell(script)} ${quoteShell(panePath)}`;
}

function isSkillDiscoveryRecord(value: unknown): value is SkillDiscoveryRecord {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as SkillDiscoveryRecord).path === 'string' &&
		typeof (value as SkillDiscoveryRecord).content === 'string'
	);
}

function parseSkillFrontmatter(content: string): {
	name: string | null;
	description: string | null;
} {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		return { name: null, description: null };
	}
	const frontmatter = match[1];
	if (!frontmatter) {
		return { name: null, description: null };
	}

	let name: string | null = null;
	let description: string | null = null;
	for (const line of frontmatter.split(/\r?\n/)) {
		const fieldMatch = line.match(/^\s*(name|description)\s*:\s*(.*?)\s*$/);
		if (!fieldMatch) continue;

		const rawValue = fieldMatch[2];
		if (rawValue === undefined) continue;
		const value = parseYamlScalar(rawValue);
		if (fieldMatch[1] === 'name') {
			name = value;
		} else {
			description = value;
		}
	}

	return { name, description };
}

function parseYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;

	const quote = trimmed[0];
	if (
		(quote === '"' || quote === "'") &&
		trimmed[trimmed.length - 1] === quote
	) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}
