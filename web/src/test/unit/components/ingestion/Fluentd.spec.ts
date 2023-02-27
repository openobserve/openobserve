import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "../../helpers/install-quasar-plugin";

import Fluentd from "../../../../components/ingestion/Fluentd.vue";

installQuasar();

describe('Fluentd', async () => {
    it("should mount Fluentd", async () => {
        const wrapper = mount(Fluentd, {
            shallow: false,
            props: {
                currOrgIdentifier: 'zinc_next',
                currUserEmail: 'tulsiraval2828@gmail.com',
                orgAPIKey: 'L"4\R{8f~56e72`0319V'
            },
        });

        expect(wrapper.vm.currOrgIdentifier).not.toBe('')
        expect(wrapper.vm.currUserEmail).not.toBe('')
        expect(wrapper.vm.orgAPIKey).not.toBe('')
    });
})