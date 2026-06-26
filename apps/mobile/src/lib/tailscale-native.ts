import { NativeModules, Platform } from 'react-native';
import { createTailscaleNativeController } from './tailscale-native-core';
import { rootLogger } from './logger';

const nativeTailscaleModule = NativeModules.FresshTailscale;
const logger = rootLogger.extend('TailscaleNative');

export const tailscaleNative = createTailscaleNativeController({
	getPlatformOS: () => Platform.OS,
	getNativeModule: () => nativeTailscaleModule,
	logger,
});
