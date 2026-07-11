import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/',
      'dist/',
      'node_modules/',
      'website/.vitepress/dist/',
      'website/.vitepress/cache/'
    ]
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
