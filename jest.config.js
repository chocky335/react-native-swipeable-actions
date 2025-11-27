module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          jsx: 'react',
          esModuleInterop: true,
          strict: true,
          module: 'commonjs',
          target: 'ES2020'
        }
      }
    ]
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/', '/__mocks__/'],
  collectCoverageFrom: [
    'src/constants.ts',
    'src/swipeStateUtils.ts',
    'src/Swipeable.types.ts',
    'src/SwipeableActions.tsx',
    'src/SwipeableView.ts',
    'src/index.ts'
  ],
  coverageThreshold: {
    'src/constants.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    },
    'src/swipeStateUtils.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  moduleNameMapper: {
    '^react$': '<rootDir>/src/__mocks__/react.ts',
    '^expo-modules-core$': '<rootDir>/src/__mocks__/expo-modules-core.ts',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts'
  }
}
