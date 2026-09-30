import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'

afterEach(() => vi.restoreAllMocks())

describe('playground boot', () => {
  it('mounts the editable Construct event sheet with its example document', () => {
    const wrapper = mount(App)

    expect(wrapper.text()).toContain('Checkpoint logic')
    expect(wrapper.text()).toContain('Player reaches the marker')
    expect(wrapper.findAll('.parameter-input').map((input) => (input.element as HTMLInputElement).value)).toContain('Player.X')
    expect(wrapper.text()).toContain('WorkshopFX.flash-once')
    expect(wrapper.text()).toContain('No registered Construct action')
    expect(wrapper.get('.event-sheet-editor').attributes('data-mode')).toBe('editing')
    expect(wrapper.get('.editor-toolbar').text()).toContain('Add event')
    expect(wrapper.text()).toContain('Developer tools')
    expect((wrapper.get('[data-test="source-input"]').element as HTMLTextAreaElement).value).toContain('Checkpoint logic')
    expect(wrapper.get('[data-test="raw-document"]').text()).toContain('event-checkpoint')
  })

  it('shows selection, runtime trace, action targets, variables, and unknown ACE diagnostics', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-node-id="construct:event-checkpoint"] .event-select').trigger('click')
    expect(wrapper.text()).toContain('construct:event-checkpoint')

    await wrapper.get('[data-test="run-preview"]').trigger('click')

    expect(wrapper.get('[data-test="execution-trace"]').text()).toContain('Player.set-x')
    expect(wrapper.get('[data-test="execution-trace"]').text()).toContain('passed')
    expect(wrapper.get('[data-test="action-targets"]').text()).toContain('player-1')
    expect(wrapper.get('[data-test="action-targets"]').text()).toContain('190')
    expect(wrapper.get('[data-test="runtime-variables"]').text()).toContain('score')
    expect(wrapper.get('[data-test="runtime-variables"]').text()).toContain('1')
    expect(wrapper.get('[data-test="unknown-aces"]').text()).toContain('WorkshopFX.flash-once')
    expect(wrapper.get('[data-test="debug-diagnostics"]').text()).toContain('construct.runtime.unsupported-action')
  })

  it('updates the viewer with streamed parser snapshots', async () => {
    const vueWarnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = mount(App)
    await wrapper.get('[data-test="start-stream"]').trigger('click')
    expect(wrapper.text()).toContain('Receiving source')

    let eventElement: Element | undefined
    let renderedSnapshots = 0
    let sawIncompleteEvent = false
    let sawIncompleteAction = false
    let sawIncompleteExpression = false
    for (let step = 0; step < 40; step += 1) {
      const next = wrapper.get('[data-test="next-chunk"]')
      if (next.element.hasAttribute('disabled')) break
      await next.trigger('click')
      const event = wrapper.find('[data-node-id="construct:event-checkpoint"]')
      if (event.exists()) {
        if (eventElement) expect(event.element).toBe(eventElement)
        else eventElement = event.element
        renderedSnapshots += 1
      }
      sawIncompleteEvent ||= wrapper.find('.event-recovery[data-state="incomplete"]').exists()
      sawIncompleteAction ||= wrapper.find('.ace-line[data-state="incomplete"]').exists()
      const expressionState = wrapper.find('.expression-state')
      sawIncompleteExpression ||= expressionState.exists() && expressionState.text().includes('incomplete')
    }

    expect(wrapper.text()).toContain('Stream complete')
    expect(wrapper.find('[data-node-id="construct:event-checkpoint"]').exists()).toBe(true)
    expect(renderedSnapshots).toBeGreaterThan(1)
    expect(sawIncompleteEvent).toBe(true)
    expect(sawIncompleteAction).toBe(true)
    expect(sawIncompleteExpression).toBe(true)
    expect(wrapper.text()).toContain('No registered Construct action for WorkshopFX.flash-once.')
    expect(wrapper.text()).toContain('score')
    expect(vueWarnings.mock.calls.flat().join('\n')).not.toContain('Duplicate keys found')
  })

  it('parses text edits back into the visual editor', async () => {
    const wrapper = mount(App)
    const sourceInput = wrapper.get('[data-test="source-input"]')
    const source = JSON.parse((sourceInput.element as HTMLTextAreaElement).value) as {
      events: Array<Record<string, unknown>>
    }
    const block = source.events.find((event) => event.eventType === 'block')
    if (!block) throw new Error('Expected a block event in the source')
    block.name = 'Renamed from text'

    await sourceInput.setValue(JSON.stringify(source, null, 2))

    expect(wrapper.text()).toContain('Renamed from text')
    expect(wrapper.get('[data-test="raw-document"]').text()).toContain('Renamed from text')
    expect(wrapper.get('[data-test="structural-diff"]').text()).toContain('update · event')
  })

  it('writes visual edits back to the source text and reports the structural change', async () => {
    const wrapper = mount(App)

    await wrapper.get('.editor-toolbar button').trigger('click')

    const source = JSON.parse((wrapper.get('[data-test="source-input"]').element as HTMLTextAreaElement).value) as {
      events: Array<Record<string, unknown>>
    }
    expect(source.events.filter((event) => event.eventType === 'block')).toHaveLength(2)
    expect(source.events.some((event) => event.name === 'New event')).toBe(true)
    expect(wrapper.get('[data-test="structural-diff"]').text()).toContain('add · event')
  })
})
