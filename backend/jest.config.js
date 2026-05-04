/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'json'],
  testMatch: ['**/*.spec.ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2023',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          allowSyntheticDefaultImports: true,
          isolatedModules: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    // Allow `.js` import suffixes (NodeNext ESM) to resolve to `.ts` source files in tests
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
