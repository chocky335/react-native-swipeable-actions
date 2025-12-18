module.exports = {
  preset: 'react-native',
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|expo-modules-core|@expo|expo)/)'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/jestSetup.js'],
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
}
