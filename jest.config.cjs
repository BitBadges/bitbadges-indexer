module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest'
  },
  globalSetup: './src/jest.setup.ts',
  globalTeardown: './src/jest.teardown.ts'
};
