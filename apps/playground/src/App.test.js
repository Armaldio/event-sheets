import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from './App.vue';
describe('playground boot', () => {
    it('mounts the Vue app and responds to interaction', async () => {
        const wrapper = mount(App);
        expect(wrapper.text()).toContain('Get started');
        await wrapper.get('button').trigger('click');
        expect(wrapper.get('button').text()).toContain('Count is 1');
    });
});
