import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { type HerdrAgent } from '@/lib/herdr/contracts';
import { groupHerdrAgents } from '@/lib/herdr/snapshot';
import { useTheme } from '@/lib/theme';

export type HerdrAgentListViewState =
	| Readonly<{ phase: 'loading' }>
	| Readonly<{ phase: 'ready'; agents: readonly HerdrAgent[] }>
	| Readonly<{ phase: 'empty' }>
	| Readonly<{ phase: 'error'; message: string }>;

type HerdrAgentListViewProps = Readonly<{
	state: HerdrAgentListViewState;
	refreshing: boolean;
	onRefresh(): void;
	onOpenAgent(terminalId: string): void;
}>;

const statusLabels: Record<HerdrAgent['status'], string> = {
	blocked: 'Blocked',
	done: 'Done',
	working: 'Working',
	idle: 'Idle',
	unknown: 'Unknown',
};

function RefreshButton(props: {
	label: 'Refresh' | 'Retry';
	refreshing: boolean;
	onRefresh(): void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			disabled={props.refreshing}
			onPress={props.onRefresh}
			style={{
				backgroundColor: theme.colors.primary,
				borderRadius: 10,
				paddingHorizontal: 16,
				paddingVertical: 10,
			}}
		>
			<Text
				style={{
					color: theme.colors.buttonTextOnPrimary,
					fontWeight: '700',
				}}
			>
				{props.refreshing ? 'Refreshing…' : props.label}
			</Text>
		</Pressable>
	);
}

export function HerdrAgentListView(props: HerdrAgentListViewProps) {
	const theme = useTheme();

	if (props.state.phase === 'loading') {
		return (
			<View
				style={{
					flex: 1,
					alignItems: 'center',
					justifyContent: 'center',
					backgroundColor: theme.colors.background,
				}}
			>
				<Text style={{ color: theme.colors.textPrimary }}>
					Loading Herdr agents…
				</Text>
			</View>
		);
	}

	if (props.state.phase === 'empty' || props.state.phase === 'error') {
		const error = props.state.phase === 'error';
		return (
			<View
				style={{
					flex: 1,
					gap: 16,
					alignItems: 'center',
					justifyContent: 'center',
					padding: 24,
					backgroundColor: theme.colors.background,
				}}
			>
				<Text
					style={{
						color: error ? theme.colors.danger : theme.colors.textPrimary,
						textAlign: 'center',
					}}
				>
					{error
						? props.state.message
						: 'No agents in the default Herdr session.'}
				</Text>
				<RefreshButton
					label={error ? 'Retry' : 'Refresh'}
					refreshing={props.refreshing}
					onRefresh={props.onRefresh}
				/>
			</View>
		);
	}

	const groups = groupHerdrAgents(props.state.agents);
	return (
		<ScrollView
			contentContainerStyle={{ gap: 20, padding: 20 }}
			style={{ backgroundColor: theme.colors.background }}
		>
			<View
				style={{
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'space-between',
				}}
			>
				<View>
					<Text
						style={{
							color: theme.colors.textPrimary,
							fontSize: 24,
							fontWeight: '800',
						}}
					>
						Herdr agents
					</Text>
					<Text style={{ color: theme.colors.muted }}>Default session</Text>
				</View>
				<RefreshButton
					label="Refresh"
					refreshing={props.refreshing}
					onRefresh={props.onRefresh}
				/>
			</View>
			{groups.map((group) => (
				<View key={group.status} style={{ gap: 8 }}>
					<Text
						style={{
							color: theme.colors.textSecondary,
							fontSize: 16,
							fontWeight: '700',
						}}
					>
						{group.label}
					</Text>
					{group.agents.map((agent) => (
						<Pressable
							key={agent.terminalId}
							testID={`herdr-agent-${agent.terminalId}`}
							accessibilityRole="button"
							onPress={() => props.onOpenAgent(agent.terminalId)}
							style={{
								gap: 4,
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 12,
								backgroundColor: theme.colors.surface,
								padding: 14,
							}}
						>
							<View
								style={{
									flexDirection: 'row',
									justifyContent: 'space-between',
								}}
							>
								<Text
									style={{
										color: theme.colors.textPrimary,
										fontSize: 16,
										fontWeight: '700',
									}}
								>
									{agent.label}
								</Text>
								<Text style={{ color: theme.colors.textSecondary }}>
									{statusLabels[agent.status]}
								</Text>
							</View>
							<Text style={{ color: theme.colors.textSecondary }}>
								{agent.workspaceLabel} / {agent.tabLabel}
							</Text>
							{agent.cwdBasename ? (
								<Text style={{ color: theme.colors.muted }}>
									{agent.cwdBasename}
								</Text>
							) : null}
						</Pressable>
					))}
				</View>
			))}
		</ScrollView>
	);
}
