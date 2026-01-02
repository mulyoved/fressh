import { type ListenerEvent } from '@fressh/react-native-uniffi-russh';
import {
	XtermJsWebView,
	type XtermWebViewHandle,
} from '@fressh/react-native-xtermjs-webview';

import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import {
	Stack,
	useLocalSearchParams,
	useRouter,
	useFocusEffect,
} from 'expo-router';
import * as LucideIcons from 'lucide-react-native';
import React, {
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Animated,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	Text,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
	ACTIVE_KEYBOARD_IDS,
	DEFAULT_KEYBOARD_ID,
	KEYBOARDS_BY_ID,
	MACROS_BY_KEYBOARD_ID,
	type KeyboardDefinition,
	type KeyboardSlot,
	type MacroDef,
	type ModifierKey,
} from '@/generated/keyboard-config';
import {
	CONFIGURATOR_URL,
	runAction,
	type ActionContext,
	type ActionId,
} from '@/lib/keyboard-actions';
import { runMacro } from '@/lib/keyboard-runtime';
import { rootLogger } from '@/lib/logger';
import { useSshStore } from '@/lib/ssh-store';
import { useTheme } from '@/lib/theme';

const logger = rootLogger.extend('TabsShellDetail');

export default function TabsShellDetail() {
	const [ready, setReady] = useState(false);

	useFocusEffect(
		React.useCallback(() => {
			startTransition(() => {
				setTimeout(() => {
					// TODO: This is gross. It would be much better to switch
					// after the navigation animation completes.
					setReady(true);
				}, 16);
			});

			return () => {
				setReady(false);
			};
		}, []),
	);

	if (!ready) return <RouteSkeleton />;
	return <ShellDetail />;
}

function RouteSkeleton() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: theme.colors.background,
			}}
		>
			<Text style={{ color: theme.colors.textPrimary, fontSize: 20 }}>
				Loading
			</Text>
		</View>
	);
}

const encoder = new TextEncoder();
const ALL_KEYBOARD_IDS = Object.keys(KEYBOARDS_BY_ID);
const ACTIVE_KEYBOARD_IDS_FALLBACK: readonly string[] =
	ACTIVE_KEYBOARD_IDS.length > 0 ? ACTIVE_KEYBOARD_IDS : ALL_KEYBOARD_IDS;
const DEFAULT_KEYBOARD_ID_FALLBACK =
	DEFAULT_KEYBOARD_ID || ACTIVE_KEYBOARD_IDS_FALLBACK[0] || '';

function ShellDetail() {
	const xtermRef = useRef<XtermWebViewHandle>(null);
	const listenerIdRef = useRef<bigint | null>(null);

	const searchParams = useLocalSearchParams<{
		connectionId?: string;
		channelId?: string;
	}>();

	if (!searchParams.connectionId || !searchParams.channelId)
		throw new Error('Missing connectionId or channelId');

	const connectionId = searchParams.connectionId;
	const channelId = parseInt(searchParams.channelId);

	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	const shell = useSshStore(
		(s) => s.shells[`${connectionId}-${channelId}` as const],
	);
	const connection = useSshStore((s) => s.connections[connectionId]);

	useEffect(() => {
		if (shell && connection) return;
		logger.info('shell or connection not found, replacing route with /shell');
		router.back();
	}, [connection, router, shell]);

	useEffect(() => {
		const xterm = xtermRef.current;
		return () => {
			if (shell && listenerIdRef.current != null)
				shell.removeListener(listenerIdRef.current);
			listenerIdRef.current = null;
			if (xterm) xterm.flush();
		};
	}, [shell]);

	const [selectedKeyboardId, setSelectedKeyboardId] =
		useState<string>(DEFAULT_KEYBOARD_ID_FALLBACK);
	const availableKeyboardIds = useMemo(
		() => new Set(ALL_KEYBOARD_IDS),
		[],
	);

	const currentKeyboard = useMemo<KeyboardDefinition | null>(() => {
		if (selectedKeyboardId && KEYBOARDS_BY_ID[selectedKeyboardId]) {
			return KEYBOARDS_BY_ID[selectedKeyboardId];
		}
		if (
			DEFAULT_KEYBOARD_ID_FALLBACK &&
			KEYBOARDS_BY_ID[DEFAULT_KEYBOARD_ID_FALLBACK]
		) {
			return KEYBOARDS_BY_ID[DEFAULT_KEYBOARD_ID_FALLBACK];
		}
		const fallbackId = ACTIVE_KEYBOARD_IDS_FALLBACK[0];
		return fallbackId ? KEYBOARDS_BY_ID[fallbackId] ?? null : null;
	}, [selectedKeyboardId]);

	const currentMacros = useMemo<MacroDef[]>(
		() =>
			currentKeyboard
				? MACROS_BY_KEYBOARD_ID[currentKeyboard.id] ?? []
				: [],
		[currentKeyboard],
	);

	// Flash message for keyboard switching
	const [flashKeyboardName, setFlashKeyboardName] = useState<string | null>(
		null,
	);
	const flashOpacity = useRef(new Animated.Value(0)).current;
	const isFirstMount = useRef(true);

	useEffect(() => {
		// Skip the flash on first mount
		if (isFirstMount.current) {
			isFirstMount.current = false;
			return;
		}

		if (!currentKeyboard) return;

		setFlashKeyboardName(currentKeyboard.name);
		flashOpacity.setValue(1);

		Animated.timing(flashOpacity, {
			toValue: 0,
			duration: 800,
			delay: 400,
			useNativeDriver: true,
		}).start(() => {
			setFlashKeyboardName(null);
		});
	}, [currentKeyboard, flashOpacity]);

	const [modifierKeysActive, setModifierKeysActive] = useState<ModifierKey[]>(
		[],
	);

	const sendBytesRaw = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			if (!shell) return;
			shell.sendData(bytes.buffer).catch((e: unknown) => {
				logger.warn('sendData failed', e);
				router.back();
			});
		},
		[shell, router],
	);

	const sendBytesWithModifiers = useCallback(
		(bytes: Uint8Array<ArrayBuffer>) => {
			if (!shell) return;
			let next = bytes;
			modifierKeysActive
				.map((key) => MODIFIER_DEFS[key])
				.sort((a, b) => a.orderPreference - b.orderPreference)
				.forEach((modifier) => {
					if (!modifier.canApplyModifierToBytes(next)) return;
					next = modifier.applyModifierToBytes(next);
				});
			sendBytesRaw(next);
		},
		[modifierKeysActive, sendBytesRaw, shell],
	);

	const sendTextRaw = useCallback(
		(value: string) => {
			sendBytesRaw(encoder.encode(value));
		},
		[sendBytesRaw],
	);

	const sendTextWithModifiers = useCallback(
		(value: string) => {
			sendBytesWithModifiers(encoder.encode(value));
		},
		[sendBytesWithModifiers],
	);

	const toggleModifier = useCallback((modifier: ModifierKey) => {
		setModifierKeysActive((prev) =>
			prev.includes(modifier)
				? prev.filter((entry) => entry !== modifier)
				: [...prev, modifier],
		);
	}, []);

	const rotateKeyboard = useCallback(() => {
		if (ACTIVE_KEYBOARD_IDS_FALLBACK.length <= 1) return;
		setSelectedKeyboardId((current) => {
			const idx = Math.max(0, ACTIVE_KEYBOARD_IDS_FALLBACK.indexOf(current));
			const nextIdx = (idx + 1) % ACTIVE_KEYBOARD_IDS_FALLBACK.length;
			return ACTIVE_KEYBOARD_IDS_FALLBACK[nextIdx] ?? current;
		});
	}, []);

	const selectKeyboardIfExists = useCallback(
		(id: string) => {
			if (!availableKeyboardIds.has(id)) return;
			setSelectedKeyboardId(id);
		},
		[availableKeyboardIds],
	);

	const handlePasteClipboard = useCallback(async () => {
		try {
			const text = await Clipboard.getStringAsync();
			if (text) sendTextRaw(text);
		} catch (error) {
			logger.warn('clipboard read failed', error);
		}
	}, [sendTextRaw]);

	const handleCopySelection = useCallback(() => {
		logger.warn('copy selection not supported on native terminal');
	}, []);

	const actionContext = useMemo<ActionContext>(
		() => ({
			availableKeyboardIds,
			selectKeyboard: selectKeyboardIfExists,
			rotateKeyboard,
			openConfigurator: () => {
				void Linking.openURL(CONFIGURATOR_URL);
			},
			sendBytes: sendBytesRaw,
			pasteClipboard: handlePasteClipboard,
			copySelection: handleCopySelection,
			toggleCommandPresets: () => {
				logger.warn('command presets not available');
			},
			openCommander: () => {
				logger.warn('commander not available');
			},
		}),
		[
			availableKeyboardIds,
			handleCopySelection,
			handlePasteClipboard,
			rotateKeyboard,
			selectKeyboardIfExists,
			sendBytesRaw,
		],
	);

	const handleAction = useCallback(
		(actionId: ActionId) => {
			void runAction(actionId, actionContext);
		},
		[actionContext],
	);

	const handleSlotPress = useCallback(
		(slot: KeyboardSlot) => {
			if (slot.type === 'modifier') {
				toggleModifier(slot.modifier);
				return;
			}
			if (slot.type === 'text') {
				sendTextWithModifiers(slot.text);
				return;
			}
			if (slot.type === 'bytes') {
				sendBytesWithModifiers(new Uint8Array(slot.bytes));
				return;
			}
			if (slot.type === 'macro') {
				const macro = currentMacros.find(
					(entry) => entry.id === slot.macroId,
				);
				if (!macro) return;
				runMacro(macro, {
					sendBytes: sendBytesRaw,
					sendText: sendTextRaw,
					onAction: handleAction,
				});
				return;
			}
			if (slot.type === 'action') {
				handleAction(slot.actionId);
				return;
			}
		},
		[
			currentMacros,
			handleAction,
			sendBytesRaw,
			sendBytesWithModifiers,
			sendTextRaw,
			sendTextWithModifiers,
			toggleModifier,
		],
	);

	// Debounced PTY resize handler
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

	const handleTerminalResize = useCallback(
		(cols: number, rows: number) => {
			// Skip if same size
			if (
				lastSizeRef.current?.cols === cols &&
				lastSizeRef.current?.rows === rows
			) {
				return;
			}
			lastSizeRef.current = { cols, rows };

			// Clear pending resize
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}

			// Debounce resize calls (100ms)
			resizeTimeoutRef.current = setTimeout(() => {
				if (!shell) return;
				logger.info(`Resizing PTY to ${cols}x${rows}`);
				shell.resizePty(cols, rows).catch((e: unknown) => {
					logger.warn('resizePty failed', e);
				});
			}, 100);
		},
		[shell],
	);

	// Cleanup resize timeout on unmount
	useEffect(() => {
		return () => {
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}
		};
	}, []);

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<KeyboardAvoidingView
				// On Android, window resizing already handles keyboard avoidance.
				// Keep KeyboardAvoidingView behavior only for iOS.
				behavior={Platform.OS === 'ios' ? 'height' : undefined}
				keyboardVerticalOffset={0}
				style={{
					flex: 1,
					backgroundColor: theme.colors.background,
					// Respect system status/navigation bars on Android.
					paddingTop: Platform.OS === 'android' ? insets.top : 0,
					// Keep a small breathing gap above the Android navigation bar.
					paddingBottom: Platform.OS === 'android' ? insets.bottom + 4 : 0,
				}}
			>
				<XtermJsWebView
					ref={xtermRef}
					style={{ flex: 1 }}
					webViewOptions={{
						// Prevent iOS from adding automatic top inset inside WebView
						contentInsetAdjustmentBehavior: 'never',
						onLayout: () => {
							// Refit terminal when container size changes
							xtermRef.current?.fit();
						},
					}}
					logger={{
						log: logger.info,
						// debug: logger.debug,
						warn: logger.warn,
						error: logger.error,
					}}
					xtermOptions={{
						theme: {
							background: theme.colors.background,
							foreground: theme.colors.textPrimary,
						},
					}}
					onResize={handleTerminalResize}
					onInitialized={() => {
						if (!shell) throw new Error('Shell not found');

						// Replay from head, then attach live listener
						void (async () => {
							const res = shell.readBuffer({ mode: 'head' });
							logger.info('readBuffer(head)', {
								chunks: res.chunks.length,
								nextSeq: res.nextSeq,
								dropped: res.dropped,
							});
							if (res.chunks.length) {
								const chunks = res.chunks.map((c) => c.bytes);
								const xr = xtermRef.current;
								if (xr) {
									xr.writeMany(chunks.map((c) => new Uint8Array(c)));
									xr.flush();
								}
							}
							const id = shell.addListener(
								(ev: ListenerEvent) => {
									if ('kind' in ev) {
										logger.warn('listener.dropped', ev);
										return;
									}
									const chunk = ev;
									const xr3 = xtermRef.current;
									if (xr3) xr3.write(new Uint8Array(chunk.bytes));
								},
								{ cursor: { mode: 'seq', seq: res.nextSeq } },
							);
							logger.info('shell listener attached', id.toString());
							listenerIdRef.current = id;
						})();
						// Focus to pop the keyboard (iOS needs the prop we set)
						const xr2 = xtermRef.current;
						if (xr2) xr2.focus();
					}}
					onData={(terminalMessage) => {
						if (!shell) return;
						sendBytesRaw(encoder.encode(terminalMessage));
					}}
				/>
				<TerminalKeyboard
					keyboard={currentKeyboard}
					modifierKeysActive={modifierKeysActive}
					onSlotPress={handleSlotPress}
				/>
				{flashKeyboardName && (
					<Animated.View
						pointerEvents="none"
						style={{
							position: 'absolute',
							top: '40%',
							left: 0,
							right: 0,
							alignItems: 'center',
							opacity: flashOpacity,
						}}
					>
						<View
							style={{
								backgroundColor: 'rgba(0, 0, 0, 0.75)',
								paddingHorizontal: 20,
								paddingVertical: 10,
								borderRadius: 8,
							}}
						>
							<Text
								style={{
									color: '#fff',
									fontSize: 16,
									fontWeight: '600',
								}}
							>
								{flashKeyboardName}
							</Text>
						</View>
					</Animated.View>
				)}
			</KeyboardAvoidingView>
		</>
	);
}
type ModifierContract = {
	canApplyModifierToBytes: (bytes: Uint8Array<ArrayBuffer>) => boolean;
	applyModifierToBytes: (
		bytes: Uint8Array<ArrayBuffer>,
	) => Uint8Array<ArrayBuffer>;
	orderPreference: number;
};

const escapeByte = 27;

const shiftModifier: ModifierContract = {
	orderPreference: 5,
	canApplyModifierToBytes: (bytes) =>
		bytes.some((byte) => byte >= 97 && byte <= 122),
	applyModifierToBytes: (bytes) => {
		const next = new Uint8Array(bytes.length);
		for (let i = 0; i < bytes.length; i += 1) {
			const byte = bytes[i];
			if (byte === undefined) continue;
			next[i] = byte >= 97 && byte <= 122 ? byte - 32 : byte;
		}
		return next;
	},
};

const ctrlModifier: ModifierContract = {
	orderPreference: 10,
	canApplyModifierToBytes: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) return false;
		return mapByteToCtrl(firstByte) != null;
	},
	applyModifierToBytes: (bytes) => {
		const firstByte = bytes[0];
		if (firstByte === undefined) return bytes;
		const ctrlByte = mapByteToCtrl(firstByte);
		if (ctrlByte == null) return bytes;
		return new Uint8Array([ctrlByte]);
	},
};

const altModifier: ModifierContract = {
	orderPreference: 20,
	canApplyModifierToBytes: (bytes) => {
		return bytes.length > 0 && bytes[0] !== escapeByte;
	},
	applyModifierToBytes: (bytes) => {
		const result = new Uint8Array(bytes.length + 1);
		result[0] = escapeByte;
		result.set(bytes, 1);
		return result;
	},
};

function mapByteToCtrl(byte: number): number | null {
	if (byte === 32) return 0; // Ctrl+Space
	const uppercase = byte & 0b1101_1111; // Fold to uppercase / control range
	if (uppercase >= 64 && uppercase <= 95) {
		return uppercase & 0x1f;
	}
	if (byte === 63) return 127; // Ctrl+?
	return null;
}

const cmdModifier: ModifierContract = {
	orderPreference: 30,
	canApplyModifierToBytes: () => false,
	applyModifierToBytes: (bytes) => bytes,
};

const MODIFIER_DEFS: Record<ModifierKey, ModifierContract> = {
	SHIFT: shiftModifier,
	CTRL: ctrlModifier,
	ALT: altModifier,
	CMD: cmdModifier,
};

type LucideIconComponent = React.ComponentType<{
	color?: string;
	size?: number;
}>;

function resolveLucideIcon(name: string | null): LucideIconComponent | null {
	if (!name) return null;
	const iconMap =
		LucideIcons as unknown as Record<string, LucideIconComponent>;
	const Icon = iconMap[name];
	return Icon ?? null;
}

function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
}: {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardSlot) => void;
}) {
	const theme = useTheme();

	if (!keyboard) {
		return (
			<View
				style={{
					borderTopWidth: 1,
					borderColor: theme.colors.border,
					padding: 12,
				}}
			>
				<Text style={{ color: theme.colors.textSecondary }}>
					No keyboard configuration. Generate code to enable shortcuts.
				</Text>
			</View>
		);
	}

	/* eslint-disable @eslint-react/no-array-index-key */
	const rows = keyboard.grid.map((row, rowIndex) => (
		<View key={`row-${rowIndex}`} style={{ flexDirection: 'row' }}>
			{row.map((slot, colIndex) => {
				if (!slot) {
					return (
						<View
							key={`slot-${rowIndex}-${colIndex}`}
							style={{ flex: 1, margin: 2 }}
						/>
					);
				}

				const modifierActive =
					slot.type === 'modifier' &&
					modifierKeysActive.includes(slot.modifier);
				const Icon = resolveLucideIcon(slot.icon);

				return (
					<Pressable
						key={`slot-${rowIndex}-${colIndex}`}
						onPress={() => onSlotPress(slot)}
						style={[
							{
								flex: 1,
								margin: 2,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
								alignItems: 'center',
								justifyContent: 'center',
							},
							modifierActive && {
								backgroundColor: theme.colors.primary,
							},
						]}
					>
						{Icon ? (
							<Icon color={theme.colors.textPrimary} size={18} />
						) : null}
						<Text
							numberOfLines={1}
							style={{
								color: theme.colors.textPrimary,
								fontSize: 10,
								marginTop: Icon ? 2 : 0,
							}}
						>
							{slot.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	));
	/* eslint-enable @eslint-react/no-array-index-key */

	return (
		<View
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
			}}
		>
			{rows}
		</View>
	);
}
