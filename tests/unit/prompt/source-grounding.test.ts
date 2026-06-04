import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('source-grounded prompt rules', () => {
  it('keeps reference-document parsing as extraction instead of creative planning', () => {
    const source = readSource('src/main/ipc/io/document-parse-handlers.ts')

    expect(source).toContain('source-grounded extraction task')
    expect(source).toContain('not a creative planning task')
    expect(source).toContain('Do not rewrite the source into a new storyline')
    expect(source).toContain('Read the document carefully enough to cover all major sections')
    expect(source).toContain('first use grep to map headings')
    expect(source).toContain('Do not read the whole file into context at once')
  })

  it('blocks generic filler slides during planning', () => {
    const sharedSource = readSource('src/main/prompt/shared.ts')
    const planningSource = readSource('src/main/prompt/planning.ts')
    const runtimeUserSource = readSource('src/main/prompt/runtime-user.ts')

    expect(planningSource).toContain('SOURCE_MATERIAL_PLANNING_RULES')
    expect(sharedSource).toContain('Apply these rules only when source documents')
    expect(sharedSource).toContain('Stay source-grounded and avoid creative drift')
    expect(sharedSource).toContain('split source-backed sections')
    expect(sharedSource).toContain('Do not add generic agenda')
    expect(planningSource).toContain('For open-ended topics without source materials')
    expect(planningSource).not.toContain('split or merge')
    expect(runtimeUserSource).toContain('hasSourceMaterialCue')
    expect(runtimeUserSource).toContain('hasSourceMaterials?: boolean')
    expect(runtimeUserSource).toContain('args.hasSourceMaterials || hasSourceMaterialCue')
    expect(runtimeUserSource).toContain('SOURCE_MATERIAL_PLANNING_RULES')
    expect(runtimeUserSource).not.toContain('Do not reinterpret the reference document into a new creative storyline')
  })

  it('requires source inspection before source-backed slide generation', () => {
    const sharedSource = readSource('src/main/prompt/shared.ts')
    const source = readSource('src/main/prompt/generation-user.ts')
    const sourceReadingSkill = readSource('resources/skills/oh-my-ppt-source-reading/SKILL.md')

    expect(sharedSource).toContain('SOURCE_READING_SKILL_NAME')
    expect(sharedSource).toContain('Before using source documents')
    expect(sharedSource).toContain('not as final evidence or permission to freestyle')
    expect(sharedSource).not.toContain('Before writing source-backed content')
    expect(sharedSource).not.toContain('Do not read entire long documents into context at once')
    expect(sourceReadingSkill).toContain('Use `grep` inside the provided `sourceDocumentPaths`')
    expect(sourceReadingSkill).toContain('Use `glob` only if the provided path points to a directory')
    expect(sourceReadingSkill).toContain('Use `read_file` only on targeted sections')
    expect(sourceReadingSkill).toContain('repeat grep -> targeted read')
    expect(sourceReadingSkill).toContain('retrieved snippet conflicts with the source passage')
    expect(sourceReadingSkill).toContain('Slide title: "Q3 Revenue Highlights"')
    expect(sourceReadingSkill).toContain('Prefer 50-80 lines around grep matches')
    expect(source).toContain('expansion must be source-grounded')
    expect(source).toContain('SOURCE_DOCUMENT_FACT_RULE')
    expect(sharedSource).toContain('examples, risks, decisions, or conclusions')
    expect(source).not.toContain('first use grep or glob')
    expect(source).not.toContain('you do not need to reread')
  })
})
