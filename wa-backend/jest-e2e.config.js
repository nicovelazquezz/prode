export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }]
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  extensionsToTreatAsEsm: ['.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
