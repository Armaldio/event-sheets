import { describe, expect, it } from 'vitest'
import { parseEditorExpression } from '../src/expression-editor.js'

describe('visual expression editing', () => {
  it('parses precedence, property access, and function calls into the shared AST', () => {
    const expression = parseEditorExpression('Player.X + max(score, 2 * 3)')

    expect(expression).toMatchObject({
      type: 'binary',
      operator: '+',
      left: {
        type: 'property',
        object: { type: 'identifier', name: 'Player' },
        property: 'X',
      },
      right: {
        type: 'call',
        callee: 'max',
        arguments: [
          { type: 'identifier', name: 'score' },
          { type: 'binary', operator: '*', left: { type: 'literal', value: 2 }, right: { type: 'literal', value: 3 } },
        ],
      },
      sourceText: 'Player.X + max(score, 2 * 3)',
    })
  })

  it('parses quoted strings and conditional expressions', () => {
    expect(parseEditorExpression('ready ? "yes" : "no"')).toMatchObject({
      type: 'conditional',
      test: { type: 'identifier', name: 'ready' },
      whenTrue: { type: 'literal', value: 'yes' },
      whenFalse: { type: 'literal', value: 'no' },
    })
  })

  it('preserves unfinished and invalid expression input without converting it to a literal', () => {
    expect(parseEditorExpression('score +')).toMatchObject({
      type: 'incomplete',
      sourceText: 'score +',
      expected: ['expression'],
    })
    expect(parseEditorExpression('Player..X')).toMatchObject({
      type: 'unknown',
      sourceText: 'Player..X',
    })
  })
})
