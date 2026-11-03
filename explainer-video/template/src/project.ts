import { makeProject } from '@revideo/core'
import { ordered } from './lib'
import { brandOutro } from './outro'
import { hook, scale, search } from './scenes'
import { C } from './theme'
import TL from './timeline.json'

export default makeProject({
  scenes: ordered([hook, search, scale, brandOutro('演示：二分查找')]),
  settings: { shared: { size: { x: TL.size[0], y: TL.size[1] }, background: C.bg } },
})
