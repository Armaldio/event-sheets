import type { Expression, JsonPrimitive } from '@project/schema'

interface Token {
  kind: 'number' | 'string' | 'identifier' | 'operator' | 'punctuation'
  value: string
  literal?: JsonPrimitive
}

class ExpressionSyntaxIssue extends Error {
  constructor(message: string, readonly incomplete = false) {
    super(message)
  }
}

const operatorPrecedence = new Map([
  ['||', 1],
  ['&&', 2],
  ['==', 3], ['!=', 3],
  ['<', 4], ['<=', 4], ['>', 4], ['>=', 4],
  ['+', 5], ['-', 5],
  ['*', 6], ['/', 6], ['%', 6],
  ['^', 7],
])

/** Parse the common, engine-neutral expression syntax edited by the visual UI. */
export function parseEditorExpression(sourceText: string): Expression {
  try {
    const parser = new ExpressionTextParser(sourceText)
    const expression = parser.parse()
    return { ...expression, sourceText }
  } catch (error) {
    if (error instanceof ExpressionSyntaxIssue && error.incomplete) {
      return { type: 'incomplete', sourceText, expected: [error.message] }
    }
    return { type: 'unknown', sourceText }
  }
}

class ExpressionTextParser {
  private readonly tokens: Token[]
  private cursor = 0

  constructor(sourceText: string) {
    this.tokens = tokenize(sourceText)
  }

  parse(): Expression {
    const expression = this.parseConditional()
    if (!this.atEnd()) throw new ExpressionSyntaxIssue('Unexpected token.')
    return expression
  }

  private parseConditional(): Expression {
    const test = this.parseBinary(1)
    if (!this.take('?')) return test
    const whenTrue = this.parseConditional()
    this.expect(':', 'colon')
    const whenFalse = this.parseConditional()
    return { type: 'conditional', test, whenTrue, whenFalse }
  }

  private parseBinary(minimumPrecedence: number): Expression {
    let left = this.parseUnary()
    while (true) {
      const operator = this.peek()?.value
      if (operator === undefined) return left
      const precedence = operatorPrecedence.get(operator)
      if (precedence === undefined || precedence < minimumPrecedence) return left
      this.cursor += 1
      const rightAssociative = operator === '^'
      const right = this.parseBinary(precedence + (rightAssociative ? 0 : 1))
      left = { type: 'binary', operator, left, right }
    }
  }

  private parseUnary(): Expression {
    const operator = this.peek()?.value
    if (operator === '!' || operator === '+' || operator === '-') {
      this.cursor += 1
      return { type: 'unary', operator, argument: this.parseUnary() }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expression {
    let expression = this.parsePrimary()
    while (!this.atEnd()) {
      if (this.take('.')) {
        const property = this.nextIdentifier('property name')
        expression = { type: 'property', object: expression, property }
        continue
      }
      if (this.take('[')) {
        const key = this.parseConditional()
        this.expect(']', 'closing bracket')
        if (key.type !== 'literal' || (typeof key.value !== 'string' && typeof key.value !== 'number')) {
          throw new ExpressionSyntaxIssue('Computed properties need a literal string or number.')
        }
        expression = { type: 'property', object: expression, property: String(key.value), computed: true }
        continue
      }
      if (this.take('(')) {
        const name = calleeName(expression)
        if (!name) throw new ExpressionSyntaxIssue('Function calls need a named callee.')
        expression = { type: 'call', callee: name, arguments: this.parseArgumentsAfterOpen() }
        continue
      }
      return expression
    }
    return expression
  }

  private parsePrimary(): Expression {
    const token = this.peek()
    if (!token) throw new ExpressionSyntaxIssue('expression', true)
    this.cursor += 1
    if (token.kind === 'number' || token.kind === 'string') {
      return { type: 'literal', value: token.literal ?? null }
    }
    if (token.kind === 'identifier') {
      if (token.value === 'true') return { type: 'literal', value: true }
      if (token.value === 'false') return { type: 'literal', value: false }
      if (token.value === 'null') return { type: 'literal', value: null }
      return { type: 'identifier', name: token.value }
    }
    if (token.value === '(') {
      const expression = this.parseConditional()
      this.expect(')', 'closing parenthesis')
      return expression
    }
    if (token.value === '[') {
      const elements = this.parseArgumentsAfterOpen(']')
      return { type: 'array', elements }
    }
    throw new ExpressionSyntaxIssue('expression')
  }

  private parseArgumentsAfterOpen(closing = ')'): Expression[] {
    const elements: Expression[] = []
    if (this.take(closing)) return elements
    while (true) {
      elements.push(this.parseConditional())
      if (this.take(closing)) return elements
      this.expect(',', 'comma or closing bracket')
    }
  }

  private nextIdentifier(expected: string): string {
    const token = this.peek()
    if (!token) throw new ExpressionSyntaxIssue(expected, true)
    if (token.kind !== 'identifier') throw new ExpressionSyntaxIssue(expected)
    this.cursor += 1
    return token.value
  }

  private expect(value: string, expected: string): void {
    if (!this.take(value)) {
      if (this.atEnd()) throw new ExpressionSyntaxIssue(expected, true)
      throw new ExpressionSyntaxIssue(expected)
    }
  }

  private take(value: string): boolean {
    if (this.peek()?.value !== value) return false
    this.cursor += 1
    return true
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor]
  }

  private atEnd(): boolean {
    return this.cursor >= this.tokens.length
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  while (cursor < source.length) {
    const character = source[cursor]
    if (character === undefined) break
    if (/\s/.test(character)) {
      cursor += 1
      continue
    }
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(source[cursor + 1] ?? ''))) {
      const start = cursor
      cursor += 1
      while (/[0-9]/.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] === '.' && /[0-9]/.test(source[cursor + 1] ?? '')) {
        cursor += 1
        while (/[0-9]/.test(source[cursor] ?? '')) cursor += 1
      }
      if (source[cursor] === 'e' || source[cursor] === 'E') {
        cursor += 1
        if (source[cursor] === '+' || source[cursor] === '-') cursor += 1
        const exponentStart = cursor
        while (/[0-9]/.test(source[cursor] ?? '')) cursor += 1
        if (exponentStart === cursor) throw new ExpressionSyntaxIssue('number exponent')
      }
      const value = Number(source.slice(start, cursor))
      if (!Number.isFinite(value)) throw new ExpressionSyntaxIssue('finite number')
      tokens.push({ kind: 'number', value: source.slice(start, cursor), literal: value })
      continue
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = cursor
      cursor += 1
      while (/[A-Za-z0-9_$]/.test(source[cursor] ?? '')) cursor += 1
      tokens.push({ kind: 'identifier', value: source.slice(start, cursor) })
      continue
    }
    if (character === '"') {
      const start = cursor
      cursor += 1
      let escaped = false
      while (cursor < source.length) {
        const current = source[cursor]
        cursor += 1
        if (escaped) escaped = false
        else if (current === '\\') escaped = true
        else if (current === '"') break
      }
      const text = source.slice(start, cursor)
      if (!text.endsWith('"') || text.length === 1) throw new ExpressionSyntaxIssue('closing quote', true)
      try {
        const literal: unknown = JSON.parse(text)
        if (typeof literal !== 'string') throw new ExpressionSyntaxIssue('quoted string')
        tokens.push({ kind: 'string', value: text, literal })
      } catch {
        throw new ExpressionSyntaxIssue('valid quoted string')
      }
      continue
    }
    const pair = source.slice(cursor, cursor + 2)
    if (['&&', '||', '==', '!=', '<=', '>='].includes(pair)) {
      tokens.push({ kind: 'operator', value: pair })
      cursor += 2
      continue
    }
    if ('+-*/%^<>!'.includes(character)) {
      tokens.push({ kind: 'operator', value: character })
      cursor += 1
      continue
    }
    if ('.,()[]?:'.includes(character)) {
      tokens.push({ kind: 'punctuation', value: character })
      cursor += 1
      continue
    }
    throw new ExpressionSyntaxIssue('expression token')
  }
  return tokens
}

function calleeName(expression: Expression): string | undefined {
  if (expression.type === 'identifier') return expression.name
  if (expression.type === 'property') {
    const parent = calleeName(expression.object)
    return parent ? parent + '.' + expression.property : undefined
  }
  return undefined
}
