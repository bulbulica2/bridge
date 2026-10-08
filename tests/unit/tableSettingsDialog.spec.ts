import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { pickSegment } from './ionEvents'
import TableSettingsDialog from '@/components/TableSettingsDialog.vue'

// The game table's settings (#181): a small dialog with the time for a set,
// which the page sends.
describe('TableSettingsDialog.vue', () => {
  const modalStub = { name: 'IonModal', emits: ['didDismiss'], template: '<div class="modal-stub"><slot /></div>' }

  function mountDialog(props: Record<string, unknown> = {}) {
    return mount(TableSettingsDialog, {
      props: { open: true, minutes: 16, ...props },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
  }

  test('the time picked goes to the page; the X closes it', async () => {
    const wrapper = mountDialog()

    expect(wrapper.get('.settings-title').text()).toBe('Table settings')
    expect(wrapper.text()).toContain('Changing it takes back every Start already pressed.')
    await pickSegment(wrapper, '12')
    expect(wrapper.emitted('change')).toEqual([[12]])

    await wrapper.get('.settings-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('busy holds the picker; a new key puts it back on the table', async () => {
    const wrapper = mountDialog({ busy: true })
    const picker = () => wrapper.getComponent({ name: 'SetMinutesPicker' })
    expect(picker().props('disabled')).toBe(true)

    await wrapper.setProps({ busy: false, minutes: 8, pickerKey: 1 })
    expect(picker().props()).toEqual(expect.objectContaining({ disabled: false, modelValue: 8 }))
  })

  test('drawn only while on show, kept until it has closed', async () => {
    const wrapper = mountDialog({ open: false })
    expect(wrapper.find('.settings-sheet').exists()).toBe(false)

    await wrapper.setProps({ open: true })
    expect(wrapper.find('.settings-sheet').exists()).toBe(true)

    // The backdrop or Escape: closed, and told.
    wrapper.findComponent(modalStub).vm.$emit('didDismiss')
    await flushPromises()
    expect(wrapper.find('.settings-sheet').exists()).toBe(false)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
