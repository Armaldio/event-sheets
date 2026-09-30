import type { Expression, JsonPrimitive, JsonValue } from '@project/schema'

type Token = { kind: 'number' | 'string' | 'identifier' | 'symbol' | 'eof'; text: string }

const operators: Record<string, { precedence: number; operator: string }> = {
  '||': { precedence: 1, operator: '||' },
  '|': { precedence: 1, operator: '|' },
  '&&': { precedence: 2, operator: '&&' },
  '&': { precedence: 2, operator: '&' },
  '==': { precedence: 3, operator: '==' },
  '===': { precedence: 3, operator: '==' },
  '=': { precedence: 3, operator: '==' },
  '!=': { precedence: 3, operator: '!=' },
  '!==': { precedence: 3, operator: '!=' },
  '<>': { precedence: 3, operator: '!=' },
  '<': { precedence: 3, operator: '<' },
  '<=': { precedence: 3, operator: '<=' },
  '>': { precedence: 3, operator: '>' },
  '>=': { precedence: 3, operator: '>=' },
  '+': { precedence: 4, operator: '+' },
  '-': { precedence: 4, operator: '-' },
  '*': { precedence: 5, operator: '*' },
  '/': { precedence: 5, operator: '/' },
  '%': { precedence: 5, operator: '%' },
  '^': { precedence: 6, operator: '^' },
}

/** Parses the common expression subset used in Construct ACE parameters. */
export function parseConstructExpression(value: JsonValue, sourceText: string): Expression {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return { type: 'literal', value }
  }
  if (typeof value !== 'string') return unknown(sourceText)
  const tokenizer = tokenize(value)
  if (!tokenizer) return looksIncomplete(value)
    ? { type: 'incomplete', sourceText, expected: ['expression'] }
    : unknown(sourceText)

  try {
    const parser = new ExpressionReader(tokenizer)
    const expression = parser.parse()
    if (!parser.atEnd()) return unknown(sourceText)
    return { ...expression, sourceText }
  } catch {
    return looksIncomplete(value)
      ? { type: 'incomplete', sourceText, expected: ['expression or closing syntax'] }
      : unknown(sourceText)
  }
}

export function parseConstructLiteral(value: JsonValue): Expression {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: 'literal', value }
  }
  return unknown(JSON.stringify(value))
}

function unknown(sourceText: string): Expression {
  return { type: 'unknown', sourceText }
}

function looksIncomplete(source: string): boolean {
  const text = source.trimEnd()
  if (!text) return true
  if (/[+\-*/%<>=!&|?:.,]$/.test(text) || /\bnot$/i.test(text)) return true
  const stack: string[] = []
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const character of text) {
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') stack.push(character)
    else if (character === ')' || character === ']') {
      if (stack.pop() !== (character === ')' ? '(' : '[')) return false
    }
  }
  return quote !== undefined || stack.length > 0
}

function tokenize(source: string): Token[] | undefined {
  const tokens: Token[] = []
  const pattern = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![A-Za-z_$])|\d+[A-Za-z_$][\w$]*|"(?:\\.|""|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|===|!==|<>|==|!=|<=|>=|&&|\|\||[+\-*/%^<>=&|!?:.,()[\]]/y
  let offset = 0
  while (offset < source.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(source)
    if (!match || match.index !== offset) return undefined
    const text = match[0]
    offset = pattern.lastIndex
    if (/^\s+$/.test(text)) continue
    const kind: Token['kind'] = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)
      ? 'number'
      : text.startsWith('"') || text.startsWith("'")
        ? 'string'
        : /^(?:[A-Za-z_$]|\d+[A-Za-z_$])/.test(text)
          ? 'identifier'
          : 'symbol'
    tokens.push({ kind, text })
  }
  tokens.push({ kind: 'eof', text: '' })
  return tokens
}

class ExpressionReader {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.peek().kind === 'eof'
  }

  parse(): Expression {
    return this.parseConditional()
  }

  private parseConditional(): Expression {
    const test = this.parseBinary(1)
    if (!this.take('?')) return test
    const whenTrue = this.parseConditional()
    this.expect(':')
    const whenFalse = this.parseConditional()
    return { type: 'conditional', test, whenTrue, whenFalse }
  }

  private parseBinary(minPrecedence: number): Expression {
    let left = this.parseUnary()
    while (true) {
      const token = this.peek()
      const binary = operators[token.text]
      if (!binary || binary.precedence < minPrecedence) break
      this.index += 1
      const right = this.parseBinary(binary.precedence + (binary.operator === '^' ? 0 : 1))
      left = { type: 'binary', operator: binary.operator, left, right }
    }
    return left
  }

  private parseUnary(): Expression {
    if (this.take('!')) return { type: 'unary', operator: '!', argument: this.parseUnary() }
    if (this.take('-')) return { type: 'unary', operator: '-', argument: this.parseUnary() }
    if (this.take('+')) return { type: 'unary', operator: '+', argument: this.parseUnary() }
    if (this.peek().kind === 'identifier' && this.peek().text.toLowerCase() === 'not') {
      this.index += 1
      return { type: 'unary', operator: 'not', argument: this.parseUnary() }
    }
    return this.parsePostfix(this.parsePrimary())
  }

  private parsePostfix(initial: Expression): Expression {
    let expression = initial
    while (true) {
      if (this.take('.')) {
        const property = this.next()
        if (property.kind !== 'identifier') throw new SyntaxError('Expected property name')
        expression = { type: 'property', object: expression, property: property.text }
        continue
      }
      if (this.take('[')) {
        const property = this.parseConditional()
        this.expect(']')
        if (property.type !== 'literal') throw new SyntaxError('Dynamic computed properties are not represented in the current schema')
        expression = {
          type: 'property',
          object: expression,
          property: String(property.value),
          computed: true,
        }
        continue
      }
      if (this.take('(')) {
        const callee = expressionCallName(expression)
        if (!callee) throw new SyntaxError('Only named expression calls are supported')
        const args: Expression[] = []
        if (!this.take(')')) {
          do args.push(this.parseConditional())
          while (this.take(','))
          this.expect(')')
        }
        expression = { type: 'call', callee, arguments: args }
        continue
      }
      return expression
    }
  }

  private parsePrimary(): Expression {
    const token = this.next()
    if (token.kind === 'number') return { type: 'literal', value: Number(token.text) }
    if (token.kind === 'string') return { type: 'literal', value: decodeString(token.text) }
    if (token.kind === 'identifier') {
      switch (token.text.toLowerCase()) {
        case 'true': return { type: 'literal', value: true }
        case 'false': return { type: 'literal', value: false }
        case 'null': return { type: 'literal', value: null }
        default: return { type: 'identifier', name: token.text }
      }
    }
    if (token.text === '(') {
      const expression = this.parseConditional()
      this.expect(')')
      return expression
    }
    if (token.text === '[') {
      const elements: Expression[] = []
      if (!this.take(']')) {
        do elements.push(this.parseConditional())
        while (this.take(','))
        this.expect(']')
      }
      return { type: 'array', elements }
    }
    throw new SyntaxError('Expected an expression')
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: 'eof', text: '' }
  }

  private next(): Token {
    const token = this.peek()
    this.index += 1
    return token
  }

  private take(text: string): boolean {
    if (this.peek().text !== text) return false
    this.index += 1
    return true
  }

  private expect(text: string): void {
    if (!this.take(text)) throw new SyntaxError(`Expected ${text}`)
  }
}

function expressionCallName(expression: Expression): string | undefined {
  if (expression.type === 'identifier') return expression.name
  if (expression.type !== 'property' || expression.computed) return undefined
  const prefix = expressionCallName(expression.object)
  return prefix === undefined ? undefined : prefix + '.' + expression.property
}

function decodeString(text: string): JsonPrimitive {
  if (text.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(text)
      if (typeof value === 'string') return value
    } catch {
      return text.slice(1, -1)
        .replaceAll('""', '"')
        .replaceAll('\\\\', '\\')
        .replaceAll('\\"', '"')
    }
  }
  return text.slice(1, -1).replaceAll("\\'", "'").replaceAll('\\\\', '\\')
}
