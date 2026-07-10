import { type DiscoveredSkill } from '../skill-discovery';
import {
	createControllerPublisher,
	type ControllerCore,
} from './controller-core';

export type SkillSelectorProject = {
	projectName: string;
	projectRoot: string;
	updatedAt: string | null;
	skills: DiscoveredSkill[];
};

export type SkillSelectorState = {
	open: boolean;
	skills: DiscoveredSkill[];
	projectName: string | null;
	projectRoot: string | null;
	updatedAt: string | null;
	isLoading: boolean;
	isRefreshing: boolean;
	error: string | null;
	refreshError: string | null;
};

export type SkillSelectorControllerCore = ControllerCore<SkillSelectorState> & {
	open(): void;
	close(): void;
	retry(): void;
	refresh(): void;
	select(skill: DiscoveredSkill): void;
	setSourceKey(sourceKey: string): void;
};

const CLOSED_STATE: SkillSelectorState = {
	open: false,
	skills: [],
	projectName: null,
	projectRoot: null,
	updatedAt: null,
	isLoading: false,
	isRefreshing: false,
	error: null,
	refreshError: null,
};

export function createSkillSelectorControllerCore(deps: {
	initialSourceKey: string;
	loadProject(input: { forceRefresh: boolean }): Promise<SkillSelectorProject>;
	sendText(value: string): void;
	requestOpen(onOpen: () => void): boolean;
	getErrorMessage(error: unknown): string;
}): SkillSelectorControllerCore {
	const publisher = createControllerPublisher(CLOSED_STATE);
	let sourceKey = deps.initialSourceKey;
	let requestId = 0;
	let disposed = false;

	const clear = () => {
		requestId += 1;
		publisher.publish(CLOSED_STATE);
	};

	const isCurrent = (id: number, requestSourceKey: string) =>
		!disposed && requestId === id && sourceKey === requestSourceKey;

	const load = async (forceRefresh: boolean) => {
		if (disposed || !publisher.getSnapshot().open) return;
		const requestSourceKey = sourceKey;
		const id = ++requestId;
		const snapshot = publisher.getSnapshot();
		const refreshVisibleSkills = forceRefresh && snapshot.projectRoot !== null;
		publisher.publish(
			refreshVisibleSkills
				? {
						...snapshot,
						isRefreshing: true,
						error: null,
						refreshError: null,
					}
				: {
						...CLOSED_STATE,
						open: true,
						isLoading: true,
					},
		);

		try {
			const project = await deps.loadProject({ forceRefresh });
			if (!isCurrent(id, requestSourceKey)) return;
			publisher.publish({
				open: true,
				skills: project.skills,
				projectName: project.projectName,
				projectRoot: project.projectRoot,
				updatedAt: project.updatedAt,
				isLoading: false,
				isRefreshing: false,
				error: null,
				refreshError: null,
			});
		} catch (error) {
			if (!isCurrent(id, requestSourceKey)) return;
			const current = publisher.getSnapshot();
			publisher.publish({
				...current,
				isLoading: false,
				isRefreshing: false,
				...(refreshVisibleSkills
					? { refreshError: deps.getErrorMessage(error) }
					: { error: deps.getErrorMessage(error) }),
			});
		}
	};

	const close = () => {
		if (disposed) return;
		clear();
	};

	return {
		getSnapshot: publisher.getSnapshot,
		subscribe: publisher.subscribe,
		open: () => {
			if (disposed) return;
			deps.requestOpen(() => {
				if (disposed) return;
				publisher.publish({ ...CLOSED_STATE, open: true });
				void load(false);
			});
		},
		close,
		retry: () => void load(true),
		refresh: () => void load(true),
		select: (skill) => {
			if (disposed || !publisher.getSnapshot().open) return;
			deps.sendText(`$${skill.name} `);
			close();
		},
		setSourceKey: (nextSourceKey) => {
			if (disposed || sourceKey === nextSourceKey) return;
			sourceKey = nextSourceKey;
			clear();
		},
		invalidate: () => {
			if (disposed) return;
			clear();
		},
		dispose: () => {
			if (disposed) return;
			clear();
			disposed = true;
			publisher.disposePublisher();
		},
	};
}
