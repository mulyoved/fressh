module.exports = {
	preset: 'jest-expo',
	testMatch: ['<rootDir>/test/components/**/*.test.ts?(x)'],
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
	transformIgnorePatterns: [
		'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
	],
};
