module.exports = {
  env: {
    browser: true,
    es2021: true
  },
  extends: 'standard-with-typescript',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json']
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/strict-boolean-expressions': 'off',
    '@typescript-eslint/space-before-function-paren': 'off',
    '@typescript-eslint/no-invalid-void-type': 'off',
    '@typescript-eslint/indent': 'off',
    '@typescript-eslint/consistent-type-assertions': 'off',
    '@typescript-eslint/brace-style': 'off',
    'generator-star-spacing': 'off'
  }
}
