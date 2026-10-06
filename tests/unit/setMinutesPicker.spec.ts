import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { IonSegment } from '@ionic/vue'
import SetMinutesPicker from '@/components/SetMinutesPicker.vue'
import { tapSegment } from './ionEvents'

describe('SetMinutesPicker.vue', () => {
  test('offers the four lengths, the current one picked', () => {
    const wrapper = mount(SetMinutesPicker, { props: { modelValue: 20, labelId: 'here' } })

    expect(wrapper.findAll('ion-segment-button').map((b) => b.text())).toEqual(['8 min', '12 min', '16 min', '20 min'])
    expect(wrapper.findComponent(IonSegment).props('modelValue')).toBe('20')
    expect(wrapper.find('ion-segment').attributes('aria-labelledby')).toBe('here')
    expect(wrapper.get('#here').text()).toBe('Time for a set, each')
  })

  test('tells a new pick, never the same one or something else', () => {
    const wrapper = mount(SetMinutesPicker, { props: { modelValue: 16, disabled: true } })
    const segment = wrapper.findComponent(IonSegment)

    // What a tap does: the element fires a kebab-case `ion-change` (#158).
    tapSegment(wrapper, '8')
    tapSegment(wrapper, '16')
    tapSegment(wrapper, '7')
    segment.vm.$emit('update:modelValue', undefined)

    expect(wrapper.emitted('update:modelValue')).toEqual([[8]])
    expect(segment.props('disabled')).toBe(true)
  })

  test("never listens for the wrapper's ionChange, which Ionic Vue never fires", () => {
    const wrapper = mount(SetMinutesPicker, { props: { modelValue: 16 } })

    wrapper.findComponent(IonSegment).vm.$emit('ionChange', { detail: { value: '8' } })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
