#!/usr/bin/env node
// detect-stack.mjs — vitest-vue2-init stack detector
// Zero deps. Run from project root. Outputs JSON to stdout.
//
// Usage:
//   node detect-stack.mjs [projectRoot]
//   projectRoot defaults to cwd.
//
// Output shape (JSON):
//   {
//     "vueVersion": "2.7.8" | "2.6.x" | null,
//     "vueMajorMinor": "2.7" | "2.6" | null,
//     "hasCompositionApi": boolean,   // true when @vue/composition-api is installed (2.6 + composition path)
//     "stateManagement": "pinia" | "vuex" | "both" | "none",
//     "syntaxStyles": {
//       "scriptSetup": number,        // count of <script setup> SFCs
//       "defineComponent": number,    // count of files calling defineComponent
//       "classComponent": number,     // count of files using @Component decorator
//       "tsx": number,                // .tsx / .jsx files
//       "templateOnly": number        // SFCs that have <template> and a plain <script> (no setup, no defineComponent, no class)
//     },
//     "privateDeps": { "<pkg>": <import count>, ... },  // grep "from '@zz-...'" usages
//     "cdnDomains": { "s1.zhuanstatic.com": <count>, "s1.zhuanspirit.com": <count>, ... },
//     "existingTestingSetup": {
//       "vitestInstalled": boolean,
//       "configFile": "vitest.config.ts" | "vitest.config.mts" | "vitest.config.js" | null,
//       "setupFile": "tests/unit/setup.ts" | null
//     },
//     "warnings": string[]
//   }

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(process.argv[2] || process.cwd())

const result = {
  vueVersion: null,
  vueMajorMinor: null,
  hasCompositionApi: false,
  stateManagement: 'none',
  syntaxStyles: { scriptSetup: 0, defineComponent: 0, classComponent: 0, tsx: 0, templateOnly: 0 },
  privateDeps: {},
  cdnDomains: {},
  existingTestingSetup: { vitestInstalled: false, configFile: null, setupFile: null },
  warnings: []
}

// ---------- package.json ----------
const pkgPath = path.join(root, 'package.json')
if (!fs.existsSync(pkgPath)) {
  console.error(`detect-stack: package.json not found at ${root}`)
  process.exit(1)
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }

// vue version (handle npm alias `vue: npm:vue@2.7.8`)
const vueDep = allDeps.vue
if (vueDep) {
  const aliasMatch = vueDep.match(/npm:vue@([\d.]+)/)
  result.vueVersion = aliasMatch ? aliasMatch[1] : vueDep.replace(/^[\^~]/, '')
  const mm = result.vueVersion.match(/^(\d+)\.(\d+)/)
  if (mm) result.vueMajorMinor = `${mm[1]}.${mm[2]}`
}

result.hasCompositionApi = !!allDeps['@vue/composition-api']

const hasPinia = !!allDeps.pinia
const hasVuex = !!allDeps.vuex
result.stateManagement = hasPinia && hasVuex ? 'both' : hasPinia ? 'pinia' : hasVuex ? 'vuex' : 'none'

result.existingTestingSetup.vitestInstalled = !!allDeps.vitest

// ---------- existing config ----------
for (const cfg of ['vitest.config.mts', 'vitest.config.ts', 'vitest.config.js']) {
  if (fs.existsSync(path.join(root, cfg))) {
    result.existingTestingSetup.configFile = cfg
    break
  }
}
const setupCandidate = path.join(root, 'tests/unit/setup.ts')
if (fs.existsSync(setupCandidate)) {
  result.existingTestingSetup.setupFile = 'tests/unit/setup.ts'
}

// ---------- src scan ----------
const SRC = path.join(root, 'src')
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '.nuxt', 'public'])

const privateDepRe = /from\s+['"](@zz[-/][^'"]+|@zz\/[^'"]+)['"]/g
const cdnRe = /(s1\.zhuanstatic\.com|s1\.zhuanspirit\.com|app\.zhuanzhuan\.com)/g

function* walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (IGNORE_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function scanFile(filePath) {
  const ext = path.extname(filePath)
  if (!['.vue', '.ts', '.tsx', '.js', '.jsx'].includes(ext)) return
  let content
  try { content = fs.readFileSync(filePath, 'utf8') } catch { return }

  // tsx / jsx
  if (ext === '.tsx' || ext === '.jsx') {
    result.syntaxStyles.tsx += 1
  }

  // .vue analysis
  if (ext === '.vue') {
    const hasScriptSetup = /<script[^>]*\bsetup\b[^>]*>/.test(content)
    const hasDefineComponent = /\bdefineComponent\s*\(/.test(content)
    const hasClassComponent = /@Component\b/.test(content) || /extends\s+Vue\b/.test(content)
    const hasTemplate = /<template[\s>]/.test(content)
    const hasPlainScript = /<script(?![^>]*\bsetup\b)[^>]*>/.test(content)

    if (hasScriptSetup) result.syntaxStyles.scriptSetup += 1
    if (hasDefineComponent && !hasScriptSetup) result.syntaxStyles.defineComponent += 1
    if (hasClassComponent) result.syntaxStyles.classComponent += 1
    if (hasTemplate && hasPlainScript && !hasScriptSetup && !hasDefineComponent && !hasClassComponent) {
      result.syntaxStyles.templateOnly += 1
    }
  }

  // private deps
  for (const m of content.matchAll(privateDepRe)) {
    const pkg = normalizePkg(m[1])
    if (!pkg) continue
    result.privateDeps[pkg] = (result.privateDeps[pkg] || 0) + 1
  }

  // cdn
  for (const m of content.matchAll(cdnRe)) {
    const host = m[1]
    result.cdnDomains[host] = (result.cdnDomains[host] || 0) + 1
  }
}

function normalizePkg(rawImportPath) {
  // '@zz-common/zz-ui' -> '@zz-common/zz-ui'
  // '@zz-common/zz-ui/lib/Foo' -> '@zz-common/zz-ui'
  // '@zz/fetch' -> '@zz/fetch'
  const parts = rawImportPath.split('/')
  if (parts.length < 2) return null
  return `${parts[0]}/${parts[1]}`
}

if (fs.existsSync(SRC)) {
  for (const file of walk(SRC)) scanFile(file)
} else {
  result.warnings.push(`src/ directory not found at ${SRC}; private deps and syntax styles not scanned.`)
}

// ---------- warnings ----------
if (result.vueMajorMinor === '2.6' && !result.hasCompositionApi && result.syntaxStyles.scriptSetup === 0) {
  // 2.6 pure options — fine
} else if (result.vueMajorMinor === '2.6' && !result.hasCompositionApi && /defineComponent|composition/.test(JSON.stringify(result))) {
  result.warnings.push('Vue 2.6 detected without @vue/composition-api but composition-style usage may exist. Verify.')
}
if (result.syntaxStyles.tsx > 0) {
  result.warnings.push(`Found ${result.syntaxStyles.tsx} TSX/JSX files. Loading reference: option-tsx-jsx.md`)
}
if (result.syntaxStyles.classComponent > 0) {
  result.warnings.push(`Found ${result.syntaxStyles.classComponent} class-component files. Loading reference: option-class-component.md`)
}
if (result.stateManagement === 'vuex' || result.stateManagement === 'both') {
  result.warnings.push('Vuex detected. Loading reference: option-vuex.md')
}
if (result.vueMajorMinor === '2.6') {
  result.warnings.push('Vue 2.6 detected. Loading reference: option-vue26.md')
}
if (Object.keys(result.privateDeps).length > 0) {
  result.warnings.push('Private @zz-* deps detected. Loading reference: private-deps-mock-catalog.md')
}
if (Object.keys(result.cdnDomains).length > 0) {
  result.warnings.push('CDN domain references detected. Loading reference: cdn-and-async-noise.md')
}
if (result.existingTestingSetup.configFile) {
  result.warnings.push(`Existing ${result.existingTestingSetup.configFile} found. vitest-vue2-init should NOT overwrite — consider vitest-vue2-testing skill instead for authoring tests.`)
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n')
