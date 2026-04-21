/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@calash/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@calash/game-core$': '<rootDir>/../../packages/game-core/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.test.json',
      diagnostics: {
        // 2835: relative imports need .js extension (test files use .ts paths via moduleNameMapper)
        ignoreCodes: [2835],
      },
    }],
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  clearMocks: true,
};
