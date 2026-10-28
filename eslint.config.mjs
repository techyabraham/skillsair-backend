import parser from '@typescript-eslint/parser'

// TypeScript handles name/type resolution. ESLint checks syntax hazards across the existing source.
export default [{ ignores: ['dist/**', '.next/**', 'node_modules/**'] }, {
  files: ['src/**/*.ts', 'src/**/*.tsx'],
  languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
  rules: { 'no-debugger': 'error', 'no-constant-binary-expression': 'error', 'no-unsafe-finally': 'error', 'constructor-super': 'error', 'no-unexpected-multiline': 'error' },
}]
