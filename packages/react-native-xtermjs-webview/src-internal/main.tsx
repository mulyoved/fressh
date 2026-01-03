import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
	bStrToBinary,
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
} from '../src/bridge';

declare global {
	interface Window {
		terminal?: Terminal;
		fitAddon?: FitAddon;
		terminalWriteBase64?: (data: string) => void;
		__FRESSH_XTERM_OPTIONS__?: ITerminalOptions;
		ReactNativeWebView?: {
			postMessage?: (data: string) => void;
			injectedObjectJson?: () => string | undefined;
		};
		__FRESSH_XTERM_BRIDGE__?: boolean;
		__FRESSH_XTERM_MSG_HANDLER__?: (
			e: MessageEvent<BridgeOutboundMessage>,
		) => void;
	}
}

const sendToRn = (msg: BridgeInboundMessage) =>
	window.ReactNativeWebView?.postMessage?.(JSON.stringify(msg));

/**
 * Idempotent boot guard: ensure we only install once.
 * If the script happens to run twice (dev reloads, double-mounts), we bail out early.
 */
window.onload = () => {
	try {
		if (window.__FRESSH_XTERM_BRIDGE__) {
			sendToRn({
				type: 'debug',
				message: 'bridge already installed; ignoring duplicate boot',
			});
			return;
		}

		const injectedObjectJson =
			window.ReactNativeWebView?.injectedObjectJson?.();
		let injectedObject: ITerminalOptions = {};
		if (injectedObjectJson) {
			try {
				injectedObject = JSON.parse(injectedObjectJson) as ITerminalOptions;
			} catch (err) {
				if (window.__FRESSH_XTERM_OPTIONS__) {
					injectedObject = window.__FRESSH_XTERM_OPTIONS__;
					sendToRn({
						type: 'debug',
						message:
							'injectedObjectJson invalid; using preloaded options',
					});
				} else {
					sendToRn({
						type: 'debug',
						message: `injectedObjectJson invalid; using defaults (${String(
							err,
						)})`,
					});
				}
			}
		} else if (window.__FRESSH_XTERM_OPTIONS__) {
			injectedObject = window.__FRESSH_XTERM_OPTIONS__;
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; using preloaded options',
			});
		} else {
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; using defaults',
			});
		}

		window.__FRESSH_XTERM_BRIDGE__ = true;

		// ---- Xterm setup
		const term = new Terminal(injectedObject);
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		const root = document.getElementById('terminal')!;
		term.open(root);
		fitAddon.fit();

		// Send initial size after first fit
		if (term.cols >= 2 && term.rows >= 1) {
			sendToRn({ type: 'sizeChanged', cols: term.cols, rows: term.rows });
		}

		const applyFontFamily = (family?: string) => {
			if (!family) return;
			const rootEl = (term.element ??
				document.querySelector('.xterm')) as HTMLElement | null;
			if (rootEl) rootEl.style.fontFamily = family;
			const helper = document.querySelector(
				'.xterm-helper-textarea',
			) as HTMLElement | null;
			if (helper) helper.style.fontFamily = family;
			const measure = document.querySelector(
				'.xterm-char-measure-element',
			) as HTMLElement | null;
			if (measure) measure.style.fontFamily = family;
		};

		applyFontFamily(injectedObject.fontFamily);

		const selectionModeClass = 'fressh-selection-mode';
		const selectionModeStyleId = 'fressh-selection-mode-style';
		const baseSelectionOptions = {
			disableStdin: Boolean(term.options.disableStdin),
			screenReaderMode: Boolean(term.options.screenReaderMode),
		};
		let selectionModeEnabled = false;
		let touchCleanup: (() => void) | null = null;
		let selectionOverlay: HTMLDivElement | null = null;
		const selectionOverlayTint = 'rgba(0, 0, 0, 0)';

		const ensureSelectionModeStyle = () => {
			if (document.getElementById(selectionModeStyleId)) return;
			const style = document.createElement('style');
			style.id = selectionModeStyleId;
			style.type = 'text/css';
			style.textContent = `
.${selectionModeClass} .xterm .xterm-accessibility {
	pointer-events: auto !important;
}
.${selectionModeClass} .xterm .xterm-accessibility-tree {
	user-select: text !important;
	-webkit-user-select: text !important;
}
`;
			(document.head || document.documentElement).appendChild(style);
		};

		const applySelectionMode = (enabled: boolean) => {
			if (selectionModeEnabled === enabled) return;
			selectionModeEnabled = enabled;
			ensureSelectionModeStyle();
			const rootEl = document.body || document.documentElement;
			rootEl?.classList.toggle(selectionModeClass, enabled);
			if (document.body) {
				document.body.style.boxShadow = '';
			}
			sendToRn({
				type: 'debug',
				message: `selection mode ${enabled ? 'enabled' : 'disabled'}`,
			});

			const termInternals = term as unknown as {
				_selectionService?: { enable?: () => void; disable?: () => void };
				_core?: { _selectionService?: { enable?: () => void; disable?: () => void } };
			};
			const selectionService =
				termInternals._selectionService ?? termInternals._core?._selectionService;

			let mouseTrackingActive = false;
			try {
				const mode = term.modes?.mouseTrackingMode;
				mouseTrackingActive = Boolean(mode && mode !== 'none');
			} catch {
				mouseTrackingActive = false;
			}

			if (enabled) {
				try {
					term.options.disableStdin = true;
					term.options.screenReaderMode = true;
				} catch (err) {
					sendToRn({
						type: 'debug',
						message: `selection options set error: ${String(err)}`,
					});
				}
				selectionService?.enable?.();
				term.element?.classList.remove('enable-mouse-events');
				sendToRn({
					type: 'debug',
					message: `selection internals ${selectionService ? 'ok' : 'missing'}`,
				});
				if (!touchCleanup) {
					touchCleanup = (() => {
						const target = term.element;
						if (!target) return null;

						// Transparent overlay to capture touch drags for selection.
						const ensureOverlay = () => {
							if (selectionOverlay) return selectionOverlay;
							const overlay = document.createElement('div');
							overlay.style.position = 'absolute';
							overlay.style.left = '0';
							overlay.style.right = '0';
							overlay.style.top = '0';
							overlay.style.bottom = '0';
							overlay.style.background = selectionOverlayTint;
							overlay.style.border = 'none';
							overlay.style.zIndex = '20';
							overlay.style.touchAction = 'none';
							overlay.style.pointerEvents = 'auto';
							const computed = window.getComputedStyle(target);
							if (computed.position === 'static') {
								target.style.position = 'relative';
							}
							target.appendChild(overlay);
							selectionOverlay = overlay;
							return overlay;
						};

						const overlay = ensureOverlay();
						term.element?.style.setProperty('outline', 'none');

						const core = term as unknown as {
							_mouseService?: {
								getCoords: (
									event: { clientX: number; clientY: number },
									element: HTMLElement,
									cols: number,
									rows: number,
									isSelection?: boolean,
								) => [number, number] | undefined;
							};
							screenElement?: HTMLElement;
							_bufferService?: {
								cols: number;
								rows: number;
								buffer: { ydisp: number };
							};
							_selectionService?: {
								clearSelection: () => void;
								refresh: (isTextLayout: boolean) => void;
								_fireEventIfSelectionChanged?: () => void;
								_model: {
									selectionStart?: [number, number];
									selectionEnd?: [number, number];
									selectionStartLength: number;
									clearSelection: () => void;
								};
							};
							_core?: {
								_mouseService?: {
									getCoords: (
										event: { clientX: number; clientY: number },
										element: HTMLElement,
										cols: number,
										rows: number,
										isSelection?: boolean,
									) => [number, number] | undefined;
								};
								_screenElement?: HTMLElement;
								_bufferService?: {
									cols: number;
									rows: number;
									buffer: { ydisp: number };
								};
								_selectionService?: {
									clearSelection: () => void;
									refresh: (isTextLayout: boolean) => void;
									_fireEventIfSelectionChanged?: () => void;
									_model: {
										selectionStart?: [number, number];
										selectionEnd?: [number, number];
										selectionStartLength: number;
										clearSelection: () => void;
									};
								};
							};
						};

						const mouseService = core._mouseService ?? core._core?._mouseService;
						const screenElement =
							core.screenElement ??
							core._core?._screenElement ??
							(target.querySelector('.xterm-screen') as HTMLElement | null);
						const bufferService =
							core._bufferService ?? core._core?._bufferService;
						const selectionService =
							core._selectionService ?? core._core?._selectionService;

						if (!mouseService || !screenElement || !bufferService || !selectionService) {
							sendToRn({
								type: 'debug',
								message: 'selection mode enabled but internals missing',
							});
							return () => {
								overlay.style.pointerEvents = 'none';
								overlay.style.display = 'none';
								term.element?.style.setProperty('outline', 'none');
							};
						}

						const getBufferCoords = (touch: Touch) => {
							const coords = mouseService.getCoords(
								{ clientX: touch.clientX, clientY: touch.clientY },
								screenElement,
								bufferService.cols,
								bufferService.rows,
								true,
							);
							if (!coords) return null;
							coords[0] -= 1;
							coords[1] -= 1;
							coords[1] += bufferService.buffer.ydisp;
							return coords as [number, number];
						};

						let activeTouchId: number | null = null;
						const findTouch = (list: TouchList) => {
							for (let i = 0; i < list.length; i += 1) {
								const touch = list.item(i);
								if (!touch) continue;
								if (touch.identifier === activeTouchId) return touch;
							}
							return list.length > 0 ? list.item(0) : null;
						};

						const startSelection = (touch: Touch) => {
							const coords = getBufferCoords(touch);
							if (!coords) return;
							selectionService.clearSelection();
							selectionService._model.selectionStart = coords;
							selectionService._model.selectionEnd = coords;
							selectionService._model.selectionStartLength = 0;
							selectionService.refresh(true);
							selectionService._fireEventIfSelectionChanged?.();
							sendToRn({
								type: 'debug',
								message: `selection touch start at ${coords[0]},${coords[1]}`,
							});
						};

						const moveSelection = (touch: Touch) => {
							const coords = getBufferCoords(touch);
							if (!coords) return;
							selectionService._model.selectionEnd = coords;
							selectionService.refresh(true);
							selectionService._fireEventIfSelectionChanged?.();
						};

						const onTouchStart = (event: TouchEvent) => {
							if (activeTouchId != null) return;
							if (event.touches.length !== 1) return;
							const touch = event.touches.item(0);
							if (!touch) return;
							activeTouchId = touch.identifier;
							startSelection(touch);
							event.preventDefault();
							sendToRn({
								type: 'debug',
								message: 'selection touch start event',
							});
						};

						const onTouchMove = (event: TouchEvent) => {
							if (activeTouchId == null) return;
							const touch = findTouch(event.touches);
							if (!touch) return;
							moveSelection(touch);
							event.preventDefault();
							sendToRn({
								type: 'debug',
								message: 'selection touch move event',
							});
						};

						const onTouchEnd = (event: TouchEvent) => {
							if (activeTouchId == null) return;
							const touch = findTouch(event.changedTouches);
							if (touch) moveSelection(touch);
							activeTouchId = null;
							try {
								const text = term.getSelection();
								sendToRn({ type: 'selectionChanged', text });
								sendToRn({
									type: 'debug',
									message: `selection touch end, length=${text.length}`,
								});
							} catch {
								sendToRn({
									type: 'debug',
									message: `selection touch end`,
								});
							}
							event.preventDefault();
						};

						const onTouchCancel = (event: TouchEvent) => {
							if (activeTouchId == null) return;
							const touch = findTouch(event.changedTouches);
							if (touch) moveSelection(touch);
							activeTouchId = null;
							event.preventDefault();
						};

						overlay.addEventListener('touchstart', onTouchStart, {
							passive: false,
						});
						overlay.addEventListener('touchmove', onTouchMove, {
							passive: false,
						});
						overlay.addEventListener('touchend', onTouchEnd, {
							passive: false,
						});
						overlay.addEventListener('touchcancel', onTouchCancel, {
							passive: false,
						});

						return () => {
							overlay.removeEventListener('touchstart', onTouchStart);
							overlay.removeEventListener('touchmove', onTouchMove);
							overlay.removeEventListener('touchend', onTouchEnd);
							overlay.removeEventListener('touchcancel', onTouchCancel);
							overlay.style.pointerEvents = 'none';
							overlay.style.display = 'none';
							term.element?.style.setProperty('outline', 'none');
						};
					})();
				}
				if (selectionOverlay) {
					selectionOverlay.style.pointerEvents = 'auto';
					selectionOverlay.style.display = 'block';
				}
			} else {
				try {
					term.options.disableStdin = baseSelectionOptions.disableStdin;
					term.options.screenReaderMode = baseSelectionOptions.screenReaderMode;
				} catch (err) {
					sendToRn({
						type: 'debug',
						message: `selection options reset error: ${String(err)}`,
					});
				}
				if (mouseTrackingActive) {
					selectionService?.disable?.();
					term.element?.classList.add('enable-mouse-events');
				} else {
					selectionService?.enable?.();
					term.element?.classList.remove('enable-mouse-events');
				}
				term.clearSelection();
				if (touchCleanup) {
					touchCleanup();
					touchCleanup = null;
				}
			}
		};

		// Expose for debugging (typed)
		window.terminal = term;
		window.fitAddon = fitAddon;

		term.onData((data) => {
			sendToRn({ type: 'input', str: data });
		});

		// Report terminal size changes back to RN (for PTY resize)
		term.onResize(({ cols, rows }) => {
			if (cols >= 2 && rows >= 1) {
				sendToRn({ type: 'sizeChanged', cols, rows });
			}
		});

		// Remove old handler if any (just in case)
		if (window.__FRESSH_XTERM_MSG_HANDLER__)
			window.removeEventListener(
				'message',
				window.__FRESSH_XTERM_MSG_HANDLER__!,
			);

		// RN -> WebView handler (write, resize, setFont, setTheme, setOptions, clear, focus)
		const handler = (e: MessageEvent<BridgeOutboundMessage>) => {
			try {
				const msg = e.data;

				if (!msg || typeof msg.type !== 'string') return;

				// TODO: https://xtermjs.org/docs/guides/flowcontrol/#ideas-for-a-better-mechanism
				const termWrite = (bStr: string) => {
					const bytes = bStrToBinary(bStr);
					term.write(bytes);
				};

				switch (msg.type) {
					case 'write': {
						termWrite(msg.bStr);
						break;
					}
					case 'writeMany': {
						for (const bStr of msg.chunks) {
							termWrite(bStr);
						}
						break;
					}
					case 'resize': {
						term.resize(msg.cols, msg.rows);
						break;
					}
					case 'fit': {
						fitAddon.fit();
						// Report new size after fit (onResize may not fire if size unchanged)
						if (term.cols >= 2 && term.rows >= 1) {
							sendToRn({ type: 'sizeChanged', cols: term.cols, rows: term.rows });
						}
						break;
					}
					case 'getSelection': {
						const text = term.getSelection();
						sendToRn({ type: 'selection', requestId: msg.requestId, text });
						break;
					}
					case 'setSelectionMode': {
						sendToRn({
							type: 'debug',
							message: `setSelectionMode ${msg.enabled ? 'on' : 'off'}`,
						});
						applySelectionMode(msg.enabled);
						break;
					}
					case 'setOptions': {
						const { theme, ...rest } = msg.opts;
						for (const key in rest) {
							if (key === 'cols' || key === 'rows') continue;
							const value = rest[key as keyof typeof rest];
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(term.options as any)[key] = value;
						}
						if (theme) {
							term.options.theme = {
								...term.options.theme,
								...theme,
							};
						}
						applyFontFamily(msg.opts.fontFamily);
						if (theme?.background) {
							document.body.style.backgroundColor = theme.background;
						}
						break;
					}
					case 'clear': {
						term.clear();
						break;
					}
					case 'focus': {
						term.focus();
						break;
					}
				}
			} catch (err) {
				sendToRn({
					type: 'debug',
					message: `message handler error: ${String(err)}`,
				});
			}
		};

		window.__FRESSH_XTERM_MSG_HANDLER__ = handler;
		window.addEventListener('message', handler);

		// Initial handshake (send once)
		setTimeout(() => {
			const ta = document.querySelector(
				'.xterm-helper-textarea',
			) as HTMLTextAreaElement | null;
			if (!ta) throw new Error('xterm-helper-textarea not found');
			ta.setAttribute('autocomplete', 'off');
			ta.setAttribute('autocorrect', 'off');
			ta.setAttribute('autocapitalize', 'none');
			ta.setAttribute('spellcheck', 'false');
			ta.setAttribute('inputmode', 'verbatim');

			return sendToRn({ type: 'initialized' });
		}, 200);
	} catch (e) {
		sendToRn({
			type: 'debug',
			message: `error in xtermjs-webview: ${String(e)}`,
		});
	}
};
