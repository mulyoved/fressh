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
		let selectionModeShownAt = 0;
		let lastSelectionText = '';
		let longPressCleanup: (() => void) | null = null;
		let touchCleanup: (() => void) | null = null;
		let selectionOverlay: HTMLDivElement | null = null;
		let startHandle: HTMLDivElement | null = null;
		let endHandle: HTMLDivElement | null = null;
		let activeHandle: 'start' | 'end' | null = null;
		let activePointerId: number | null = null;
		const selectionOverlayTint = 'rgba(0, 0, 0, 0)';
		const longPressTimeoutMs = 500;
		const longPressSlopPx = 8;
		// Guard against immediate hide right after long-press selection activates.
		const selectionHideGuardMs = 300;

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
.${selectionModeClass} .fressh-selection-handle {
	position: absolute;
	width: 18px;
	height: 18px;
	border-radius: 999px;
	background: rgba(37, 99, 235, 0.9);
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85);
	transform: translate(-50%, -10%);
	touch-action: none;
	z-index: 30;
}
`;
			(document.head || document.documentElement).appendChild(style);
		};

		type WorkCell = { getWidth: () => number; getChars?: () => string };
		type LineLike = {
			getCell?: (col: number) => WorkCell | null;
			loadCell?: (col: number, cell: WorkCell) => WorkCell;
		};

		const getSelectionCore = () => {
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
					buffer: {
						ydisp: number;
						lines: {
							get: (
								idx: number,
							) =>
								| {
										getCell: (
											col: number,
										) =>
											| { getWidth: () => number; getChars?: () => string }
											| null;
								  }
								| undefined;
						};
					};
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
						buffer: {
							ydisp: number;
							lines: {
								get: (
									idx: number,
								) =>
									| {
											getCell: (
												col: number,
											) =>
												| { getWidth: () => number; getChars?: () => string }
												| null;
									  }
									| undefined;
							};
						};
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
				(term.element?.querySelector('.xterm-screen') as HTMLElement | null);
			const bufferService = core._bufferService ?? core._core?._bufferService;
			const selectionService =
				core._selectionService ?? core._core?._selectionService;
			const workCell = (selectionService as { _workCell?: WorkCell } | undefined)
				?._workCell;

			if (!mouseService || !screenElement || !bufferService || !selectionService) {
				return null;
			}
			return {
				mouseService,
				screenElement,
				bufferService,
				selectionService,
				workCell,
			};
		};

		const getBufferCoords = (
			clientX: number,
			clientY: number,
		): [number, number] | null => {
			const core = getSelectionCore();
			if (!core) return null;
			const coords = core.mouseService.getCoords(
				{ clientX, clientY },
				core.screenElement,
				core.bufferService.cols,
				core.bufferService.rows,
				true,
			);
			if (!coords) return null;
			coords[0] -= 1;
			coords[1] -= 1;
			coords[1] += core.bufferService.buffer.ydisp;
			return coords as [number, number];
		};

		const getCellData = (
			line: LineLike,
			col: number,
			core: { workCell?: WorkCell },
		) => {
			if (typeof line.getCell === 'function') {
				return line.getCell(col) ?? null;
			}
			if (typeof line.loadCell === 'function' && core.workCell) {
				return line.loadCell(col, core.workCell);
			}
			return null;
		};

		const normalizeSelectionColumn = (
			line: LineLike,
			col: number,
			core: { workCell?: WorkCell },
		) => {
			let c = Math.max(0, col);
			const initial = getCellData(line, c, core);
			if (!initial) return c;
			if (initial.getWidth() !== 0) return c;
			while (c > 0) {
				c -= 1;
				const cell = getCellData(line, c, core);
				if (cell && cell.getWidth() > 0) return c;
			}
			return c;
		};

		const expandToWord = (
			coords: [number, number],
		): { start: [number, number]; end: [number, number] } => {
			const core = getSelectionCore();
			if (!core) return { start: coords, end: coords };
			const [xRaw, y] = coords;
			const line = core.bufferService.buffer.lines.get(y);
			if (!line) {
				return { start: coords, end: coords };
			}
			const x = normalizeSelectionColumn(line, xRaw, core);
			const cell = getCellData(line, x, core);
			const char = cell?.getChars?.() ?? '';
			const separators = term.options.wordSeparator ?? '';
			const isSeparator = (value: string) =>
				value.trim().length === 0 || separators.includes(value);
			if (!char || isSeparator(char)) {
				return { start: [x, y], end: [x, y] };
			}
			let left = x;
			let right = x;
			while (left > 0) {
				const nextCol = normalizeSelectionColumn(line, left - 1, core);
				const nextCell = getCellData(line, nextCol, core);
				const nextChar = nextCell?.getChars?.() ?? '';
				if (!nextChar || isSeparator(nextChar)) break;
				left = nextCol;
				if (nextCol === 0) break;
			}
			while (right < core.bufferService.cols - 1) {
				const nextCol = normalizeSelectionColumn(line, right + 1, core);
				if (nextCol <= right) break;
				const nextCell = getCellData(line, nextCol, core);
				const nextChar = nextCell?.getChars?.() ?? '';
				if (!nextChar || isSeparator(nextChar)) break;
				right = nextCol;
				if (right >= core.bufferService.cols - 1) break;
			}
			return { start: [left, y], end: [right, y] };
		};

		const emitSelectionChanged = () => {
			let text = '';
			try {
				text = term.getSelection() || '';
			} catch {
				text = '';
			}
			if (text === lastSelectionText) return;
			lastSelectionText = text;
			sendToRn({ type: 'selectionChanged', text });
		};

		const renderSelectionHandles = () => {
			if (!selectionModeEnabled) {
				if (startHandle) startHandle.style.display = 'none';
				if (endHandle) endHandle.style.display = 'none';
				return;
			}
			const core = getSelectionCore();
			if (!core) return;
			const selectionService = core.selectionService as typeof core.selectionService & {
				selectionStart?: [number, number];
				selectionEnd?: [number, number];
			};
			const model = selectionService._model;
			const selectionStart = selectionService.selectionStart ?? model.selectionStart;
			const selectionEnd = selectionService.selectionEnd ?? model.selectionEnd;
			if (!selectionStart || !selectionEnd) {
				if (startHandle) startHandle.style.display = 'none';
				if (endHandle) endHandle.style.display = 'none';
				return;
			}
			const renderService = (term as unknown as {
				_core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
				_renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } };
			})._renderService ??
				(term as unknown as {
					_core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
				})._core?._renderService;
			const cellWidth = renderService?.dimensions?.css?.cell?.width;
			const cellHeight = renderService?.dimensions?.css?.cell?.height;
			if (!cellWidth || !cellHeight) return;

			const rootEl = term.element;
			const screenRect = core.screenElement.getBoundingClientRect();
			const rootRect = rootEl?.getBoundingClientRect();
			if (!rootEl || !rootRect) return;

			const offsetX = screenRect.left - rootRect.left;
			const offsetY = screenRect.top - rootRect.top;
			const ydisp = core.bufferService.buffer.ydisp;

			const startRow = selectionStart[1] - ydisp;
			const endRow = selectionEnd[1] - ydisp;
			if (startRow < 0 || startRow >= core.bufferService.rows) {
				if (startHandle) startHandle.style.display = 'none';
			} else {
				const startX = offsetX + selectionStart[0] * cellWidth;
				const startY = offsetY + startRow * cellHeight;
				startHandle = startHandle ?? document.createElement('div');
				startHandle.className = 'fressh-selection-handle';
				startHandle.style.display = 'block';
				startHandle.style.left = `${startX}px`;
				startHandle.style.top = `${startY}px`;
				if (!startHandle.parentElement) rootEl.appendChild(startHandle);
			}

			const endRowVisible = endRow >= 0 && endRow < core.bufferService.rows;
			if (!endRowVisible) {
				if (endHandle) endHandle.style.display = 'none';
			} else {
				const endX = offsetX + selectionEnd[0] * cellWidth;
				const endY = offsetY + endRow * cellHeight;
				endHandle = endHandle ?? document.createElement('div');
				endHandle.className = 'fressh-selection-handle';
				endHandle.style.display = 'block';
				endHandle.style.left = `${endX}px`;
				endHandle.style.top = `${endY}px`;
				if (!endHandle.parentElement) rootEl.appendChild(endHandle);
			}
			if (startHandle || endHandle) ensureHandleListeners();
		};

		const updateSelectionRange = (
			start: [number, number],
			end: [number, number],
		) => {
			const core = getSelectionCore();
			if (!core) return;
			sendToRn({
				type: 'debug',
				message: `updateSelectionRange start=${start[0]},${start[1]} end=${end[0]},${end[1]}`,
			});
			try {
				const maxRow =
					core.bufferService.buffer.ydisp + core.bufferService.rows - 1;
				const minRow = core.bufferService.buffer.ydisp;
				const startRow = Math.max(minRow, Math.min(start[1], maxRow));
				const endRow = Math.max(minRow, Math.min(end[1], maxRow));
				const clampColInclusive = (value: number) =>
					Math.max(0, Math.min(value, core.bufferService.cols - 1));
				let [sx, sy] = [clampColInclusive(start[0]), startRow];
				let [exInclusive, ey] = [clampColInclusive(end[0]), endRow];
				if (sy > ey || (sy === ey && sx > exInclusive)) {
					if (activeHandle === 'start') {
						sy = ey;
						sx = exInclusive;
					} else if (activeHandle === 'end') {
						ey = sy;
						exInclusive = sx;
					}
				}
				const endExclusive =
					exInclusive < core.bufferService.cols - 1
						? exInclusive + 1
						: core.bufferService.cols;
				const ex = endExclusive;
				const length = Math.max(1, (ey - sy) * core.bufferService.cols + (ex - sx));
				const selectionService = core.selectionService as typeof core.selectionService & {
					setSelection?: (col: number, row: number, length: number) => void;
				};
				if (selectionService.setSelection) {
					selectionService.setSelection(sx, sy, length);
				} else {
					core.selectionService._model.selectionStart = [sx, sy];
					core.selectionService._model.selectionEnd = [ex, ey];
					core.selectionService._model.selectionStartLength = 0;
					core.selectionService.refresh(true);
					core.selectionService._fireEventIfSelectionChanged?.();
				}
				try {
					const selectionText = term.getSelection() || '';
					sendToRn({
						type: 'debug',
						message: `selection updated len=${selectionText.length} start=${sx},${sy} end=${ex},${ey} ydisp=${core.bufferService.buffer.ydisp}`,
					});
				} catch {
					sendToRn({
						type: 'debug',
						message: `selection updated start=${sx},${sy} end=${ex},${ey} ydisp=${core.bufferService.buffer.ydisp}`,
					});
				}
				renderSelectionHandles();
			} catch (err) {
				sendToRn({
					type: 'debug',
					message: `selection update error: ${String(err)}`,
				});
			}
		};

		const ensureHandleListeners = () => {
			const rootEl = term.element;
			if (!rootEl) return;
			const attach = (handle: HTMLDivElement, kind: 'start' | 'end') => {
				if (handle.dataset.listenersAttached === 'true') return;
				const onPointerDown = (event: PointerEvent) => {
					if (!selectionModeEnabled) return;
					activeHandle = kind;
					activePointerId = event.pointerId;
					handle.setPointerCapture(event.pointerId);
					event.preventDefault();
					event.stopPropagation();
				};
				const onPointerMove = (event: PointerEvent) => {
					if (!selectionModeEnabled) return;
					if (activeHandle !== kind || activePointerId !== event.pointerId) return;
					const coords = getBufferCoords(event.clientX, event.clientY);
					if (!coords) return;
					const core = getSelectionCore();
					if (!core) return;
					const line = core.bufferService.buffer.lines.get(coords[1]);
					const normalizedCol = line
						? normalizeSelectionColumn(line, coords[0], core)
						: coords[0];
					const model = core.selectionService._model;
					const start = model.selectionStart ?? coords;
					const end = model.selectionEnd ?? coords;
					if (kind === 'start') {
						updateSelectionRange([normalizedCol, coords[1]], end);
					} else {
						updateSelectionRange(start, [normalizedCol, coords[1]]);
					}
					event.preventDefault();
					event.stopPropagation();
				};
				const onPointerUp = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					activeHandle = null;
					activePointerId = null;
					handle.releasePointerCapture(event.pointerId);
					emitSelectionChanged();
					event.preventDefault();
					event.stopPropagation();
				};
				const onPointerCancel = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					activeHandle = null;
					activePointerId = null;
					handle.releasePointerCapture(event.pointerId);
					event.preventDefault();
					event.stopPropagation();
				};
				handle.addEventListener('pointerdown', onPointerDown);
				handle.addEventListener('pointermove', onPointerMove);
				handle.addEventListener('pointerup', onPointerUp);
				handle.addEventListener('pointercancel', onPointerCancel);
				handle.dataset.listenersAttached = 'true';
			};
			if (startHandle) attach(startHandle, 'start');
			if (endHandle) attach(endHandle, 'end');
		};

		const applySelectionMode = (
			enabled: boolean,
			opts: { force?: boolean } = {},
		) => {
			if (!enabled && selectionModeEnabled && !opts.force) {
				if (Date.now() - selectionModeShownAt < selectionHideGuardMs) return;
			}
			if (selectionModeEnabled === enabled) return;
			selectionModeEnabled = enabled;
			if (enabled) selectionModeShownAt = Date.now();
			ensureSelectionModeStyle();
			const rootEl = document.body || document.documentElement;
			rootEl?.classList.toggle(selectionModeClass, enabled);
			if (document.body) {
				document.body.style.boxShadow = '';
			}
			sendToRn({ type: 'selectionModeChanged', enabled });
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

						let tapStart: { x: number; y: number } | null = null;
						const onTouchStart = (event: TouchEvent) => {
							if (!selectionModeEnabled) return;
							if (event.touches.length !== 1) return;
							const touch = event.touches.item(0);
							if (!touch) return;
							tapStart = { x: touch.clientX, y: touch.clientY };
							event.preventDefault();
						};
						const onTouchMove = (event: TouchEvent) => {
							if (!tapStart) return;
							const touch = event.touches.item(0);
							if (!touch) return;
							const dx = touch.clientX - tapStart.x;
							const dy = touch.clientY - tapStart.y;
							if (Math.hypot(dx, dy) > longPressSlopPx) {
								tapStart = null;
							}
							event.preventDefault();
						};
						const onTouchEnd = (event: TouchEvent) => {
							if (!tapStart) return;
							tapStart = null;
							applySelectionMode(false);
							event.preventDefault();
						};
						const onTouchCancel = (event: TouchEvent) => {
							tapStart = null;
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
				renderSelectionHandles();
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
				activeHandle = null;
				activePointerId = null;
				term.clearSelection();
				if (startHandle) startHandle.style.display = 'none';
				if (endHandle) endHandle.style.display = 'none';
				emitSelectionChanged();
				if (touchCleanup) {
					touchCleanup();
					touchCleanup = null;
				}
			}
		};

		const installLongPressHandlers = () => {
			if (longPressCleanup) return;
			const target = getSelectionCore()?.screenElement ?? term.element;
			if (!target) return;

			let longPressTimer: ReturnType<typeof setTimeout> | null = null;
			let startPoint: { x: number; y: number } | null = null;
			let longPressFired = false;
			let activePointerId: number | null = null;

			const clearLongPress = () => {
				if (longPressTimer) {
					clearTimeout(longPressTimer);
					longPressTimer = null;
				}
				startPoint = null;
				longPressFired = false;
				activePointerId = null;
			};

			const startLongPress = (x: number, y: number) => {
				if (selectionModeEnabled) return;
				startPoint = { x, y };
				longPressFired = false;
				longPressTimer = setTimeout(() => {
					if (!startPoint) return;
					const coords = getBufferCoords(startPoint.x, startPoint.y);
					if (!coords) {
						sendToRn({
							type: 'debug',
							message: `long-press coords unavailable at ${startPoint.x},${startPoint.y}`,
						});
						return;
					}
					// Enter selection mode on long-press and seed selection around the touch.
					applySelectionMode(true, { force: true });
					sendToRn({
						type: 'debug',
						message: `long-press coords ${coords[0]},${coords[1]}`,
					});
					let expanded = { start: coords, end: coords };
					try {
						expanded = expandToWord(coords);
						sendToRn({
							type: 'debug',
							message: `expandToWord start=${expanded.start[0]},${expanded.start[1]} end=${expanded.end[0]},${expanded.end[1]}`,
						});
					} catch (err) {
						sendToRn({
							type: 'debug',
							message: `expandToWord error: ${String(err)}`,
						});
					}
					sendToRn({
						type: 'debug',
						message: `apply selection start=${expanded.start[0]},${expanded.start[1]} end=${expanded.end[0]},${expanded.end[1]}`,
					});
					updateSelectionRange(expanded.start, expanded.end);
					renderSelectionHandles();
					emitSelectionChanged();
					longPressFired = true;
				}, longPressTimeoutMs);
			};

			const moveLongPress = (x: number, y: number) => {
				if (!startPoint || !longPressTimer) return;
				const dx = x - startPoint.x;
				const dy = y - startPoint.y;
				if (Math.hypot(dx, dy) > longPressSlopPx) {
					clearLongPress();
				}
			};

			const finishLongPress = (event?: Event) => {
				if (longPressFired) {
					event?.preventDefault?.();
				}
				clearLongPress();
			};

			if ('PointerEvent' in window) {
				const onPointerDown = (event: PointerEvent) => {
					if (selectionModeEnabled) return;
					if (event.pointerType && event.pointerType !== 'touch') return;
					activePointerId = event.pointerId;
					startLongPress(event.clientX, event.clientY);
				};
				const onPointerMove = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					moveLongPress(event.clientX, event.clientY);
				};
				const onPointerUp = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					finishLongPress(event);
				};
				const onPointerCancel = (event: PointerEvent) => {
					if (activePointerId !== event.pointerId) return;
					clearLongPress();
				};
				target.addEventListener('pointerdown', onPointerDown);
				target.addEventListener('pointermove', onPointerMove);
				target.addEventListener('pointerup', onPointerUp);
				target.addEventListener('pointercancel', onPointerCancel);

				longPressCleanup = () => {
					target.removeEventListener('pointerdown', onPointerDown);
					target.removeEventListener('pointermove', onPointerMove);
					target.removeEventListener('pointerup', onPointerUp);
					target.removeEventListener('pointercancel', onPointerCancel);
					clearLongPress();
				};
				return;
			}

			const onTouchStart = (event: TouchEvent) => {
				if (selectionModeEnabled) return;
				if (event.touches.length !== 1) return;
				const touch = event.touches.item(0);
				if (!touch) return;
				startLongPress(touch.clientX, touch.clientY);
			};
			const onTouchMove = (event: TouchEvent) => {
				if (!startPoint || !longPressTimer) return;
				const touch = event.touches.item(0);
				if (!touch) return;
				moveLongPress(touch.clientX, touch.clientY);
			};
			const onTouchEnd = (event: TouchEvent) => {
				finishLongPress(event);
			};
			const onTouchCancel = () => {
				clearLongPress();
			};

			target.addEventListener('touchstart', onTouchStart, { passive: true });
			target.addEventListener('touchmove', onTouchMove, { passive: true });
			target.addEventListener('touchend', onTouchEnd, { passive: false });
			target.addEventListener('touchcancel', onTouchCancel, {
				passive: true,
			});

			longPressCleanup = () => {
				target.removeEventListener('touchstart', onTouchStart);
				target.removeEventListener('touchmove', onTouchMove);
				target.removeEventListener('touchend', onTouchEnd);
				target.removeEventListener('touchcancel', onTouchCancel);
				clearLongPress();
			};
		};

		installLongPressHandlers();
		term.onResize(() => {
			if (selectionModeEnabled) renderSelectionHandles();
		});

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
						applySelectionMode(msg.enabled, { force: true });
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
