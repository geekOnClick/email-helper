import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Игнорируем служебные каталоги и артефакты
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'openspec/', '.pi/', 'docker/'],
  },
  // Базовые рекомендации
  js.configs.recommended,
  // Строгий TypeScript (type-aware правила требуют tsconfig.json)
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Разрешаем any в отдельных местах последующих фаз при необходимости
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
