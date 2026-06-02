import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkspace,
  readWorkspace,
  resolveThinkingDir,
  writeMessagesList
} from '../../../src/main/thinking/workspace'

const tempDirs: string[] = []

async function makeStorageRoot(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'thinking-workspace-test-'))
  tempDirs.push(dir)
  return dir
}

describe('thinking workspace messages', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  it('persists and restores sanitized chat messages', async () => {
    const storageRoot = await makeStorageRoot()
    const workspace = await createWorkspace(storageRoot)
    const thinkingDir = resolveThinkingDir(storageRoot, workspace.thinkingId)

    await writeMessagesList(thinkingDir, [
      {
        role: 'user',
        content: '2026 ai短剧的发展',
        timestamp: 1000
      },
      {
        role: 'assistant',
        content: '"topic": "2026年AI短剧的发展",\n  "userIntent": "规划演示"\n}\n\n我已确认主题。',
        timestamp: 1001
      },
      {
        role: 'assistant',
        content: 'context.md updated for stage collect.',
        timestamp: 1002
      }
    ])

    const restored = await readWorkspace(storageRoot, workspace.thinkingId)

    expect(restored.messages).toEqual([
      {
        role: 'user',
        content: '2026 ai短剧的发展',
        timestamp: 1000
      },
      {
        role: 'assistant',
        content: '我已确认主题。',
        timestamp: 1001
      }
    ])
  })
})
