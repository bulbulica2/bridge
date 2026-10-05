import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { IonSegment } from '@ionic/vue'
import SetMinutesPicker from '@/components/SetMinutesPicker.vue'

// ion-segment scrolls its checked button into view; jsdom has no scrolling.
Element.prototype.scrollTo ??= () => {}

describe('SetMinutesPicker.vue', () => {
  test('offers the four lengths, the current one picked', () => {
    const wrapper = mount(SetMinutesPicker, { props: { modelValue: 20, labelId: 'here' } })

    expect(wrapper.findAll('ion-segment-button').map((b) => b.text())).toEqual(['8 min', '12 min', '16 min', '20 min'])
    expect(wrapper.findComponent(IonSegment).props('value')).toBe('20')
    expect(wrapper.find('ion-segment').attributes('aria-labelledby')).toBe('here')
    expect(wrapper.get('#here').text()).toBe('Time for a set, each')
  })

  test('tells a new pick, never the same one or something else', () => {
    const wrapper = mount(SetMinutesPicker, { props: { modelValue: 16, disabled: true } })
    const segment = wrapper.findComponent(IonSegment)

    segment.vm.$emit('ionChange', { detail: { value: '8' } })
    segment.vm.$emit('ionChange', { detail: { value: '16' } })
    segment.vm.$emit('ionChange', { detail: { value: '7' } })
    segment.vm.$emit('ionChange', { detail: { value: undefined } })

    expect(wrapper.emitted('update:modelValue')).toEqual([[8]])
    expect(segment.props('disabled')).toBe(true)
  })
})
