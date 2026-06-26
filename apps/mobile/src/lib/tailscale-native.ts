import { NativeModules, Platform } from 'react-native';
import {
	createTailscaleNativeController,
	type TailscaleNativeModule,
} from './tailscale-native-core';
import { rootLogger } from './logger';

const nativeTailscaleModule = NativeModules.FresshTailscale as
	| TailscaleNativeModule
	| undefined;
const logger = rootLogger.extend('TailscaleNative');

export const tailscaleNative = createTailscaleNativeController({
	getPlatformOS: () => Platform.OS,
	getNativeModule: () => nativeTailscaleModule,
	logger,
});
