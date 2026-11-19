/**
 * ESLint flat configuration.
 *
 * Besides the usual TypeScript/Vue rules, this file enforces the layering
 * described in AGENTS.md:
 * - src/core   : pure TypeScript, no Three.js, no Vue, no render/app import;
 * - src/render : Three.js only, no Vue, no app import;
 * - src/app    : may import everything.
 * It also requires TSDoc comments on exported symbols of core and render, so
 * the code stays readable for the next human or agent.
 */
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import jsdoc from 'eslint-plugin-jsdoc'
import skipFormatting from 'eslint-config-prettier/flat'
import globals from 'globals'

const coreMessage =
  'src/core must stay pure TypeScript (no Three.js, no Vue, no render/app). See AGENTS.md.'
const renderMessage = 'src/render must not depend on Vue or src/app. See AGENTS.md.'

export default defineConfigWithVueTs(
  {
    name: 'project/ignores',
    // eslint.config.js is not part of any tsconfig, so type-aware rules cannot run on it.
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'eslint.config.js',
      // Generated: model pipeline intermediates, desktop demo runtimes and builds.
      'tooling/.build/**',
      'bin/**',
      'release/**',
    ],
  },
  {
    name: 'project/files',
    files: ['**/*.{ts,mts,vue}'],
    languageOptions: { globals: globals.browser },
  },

  pluginVue.configs['flat/recommended'],
  vueTsConfigs.strictTypeChecked,
  vueTsConfigs.stylisticTypeChecked,

  {
    name: 'project/typescript-tweaks',
    rules: {
      // Numbers in template literals are common in coordinates/debug output.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    name: 'project/layer-core',
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: coreMessage },
            { group: ['vue', 'vue/*', '@vue/*'], message: coreMessage },
            {
              group: ['@/render', '@/render/*', '@/app', '@/app/*', '**/render/**', '**/app/**'],
              message: coreMessage,
            },
          ],
        },
      ],
    },
  },
  {
    name: 'project/layer-render',
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['vue', 'vue/*', '@vue/*'], message: renderMessage },
            { group: ['@/app', '@/app/*', '**/app/**'], message: renderMessage },
          ],
        },
      ],
    },
  },

  {
    name: 'project/docs',
    files: ['src/core/**/*.ts', 'src/render/**/*.ts'],
    ignores: ['**/*.test.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          checkConstructors: false,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            // Exported arrow functions are covered by the VariableDeclaration context below;
            // inline arrows (callbacks, object members) do not need their own block.
            ArrowFunctionExpression: false,
            FunctionExpression: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
      'jsdoc/check-alignment': 'error',
      'jsdoc/no-types': 'error',
    },
  },

  skipFormatting,
)
